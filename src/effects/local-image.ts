import { requiredValue } from "./runtime/required-value";
import { PAPER_IMAGE_FILTERS } from "../shared/image-filter-metadata";
import type {
  LocalImageSettings,
  LocalImageAssetId,
} from "../shared/local-image";
import type { ImageSession } from "../services/contracts";
import {
  thumbnailFromPrepared,
  type PreparedLocalImage,
} from "../platform/images/local-image-loading";
import type {
  BackgroundInstance,
  BackgroundUpdateContext,
} from "./runtime/contracts";
import type { ImageFilterInstance } from "./paper/images/adapter";
export interface LocalImageInstance extends BackgroundInstance {
  configure(settings: LocalImageSettings): void;
}
import { displayDimensions } from "../domain/images/local-image-geometry";
// Read-only UI seam: owner URLs and DOM never leave this module.
const preparedByHost = new WeakMap<
  HTMLElement,
  { assetId: LocalImageAssetId; image: PreparedLocalImage }
>();
export function preparedImageThumbnail(
  host: HTMLElement,
  expectedAssetId: LocalImageAssetId,
): Promise<Blob> | undefined {
  const prepared = preparedByHost.get(host);
  return prepared?.assetId === expectedAssetId
    ? thumbnailFromPrepared(prepared.image)
    : undefined;
}
export async function createLocalImage(
  images: Pick<ImageSession, "assets" | "prepare">,
  host: HTMLElement,
  settings: LocalImageSettings,
  signal: AbortSignal,
  candidate?: PreparedLocalImage,
  initialContext?: BackgroundUpdateContext,
  reportFilterStatus: (message: string) => void = () => {},
): Promise<LocalImageInstance> {
  const cancelled = () => document.hidden || signal.aborted;
  let prepared = candidate;
  try {
    if (cancelled()) throw new Error("Image load cancelled.");
    if (!settings.assetId)
      throw new Error("Saved image unavailable. Retry, replace or remove it.");
    if (!prepared) {
      const asset = await images.assets.get(settings.assetId);
      if (!asset)
        throw new Error(
          "Saved image unavailable. Retry, replace or remove it.",
        );
      if (cancelled()) throw new Error("Image load cancelled.");
      prepared = await images.prepare(asset.original, settings.fit, signal);
    }
    if (cancelled()) throw new Error("Image load cancelled.");
    // Capture identity at creation, never from later settings or UI publication.
    const assetId = settings.assetId;
    let owned = prepared,
      disposed = false,
      resizing = false,
      resizeInvalidated = false,
      visible = !document.hidden;
    const isResizeInvalidated = () => resizeInvalidated;
    let context = initialContext;
    const isLive = () => !disposed && visible && !cancelled();
    let filter: ImageFilterInstance | undefined,
      filterAbort: AbortController | undefined;
    let filterGeneration = 0;
    const stopFilter = () => {
      filterGeneration++;
      filterAbort?.abort();
      filter?.destroy();
      filter = undefined;
    };
    const startFilter = () => {
      stopFilter();
      reportFilterStatus("");
      if (
        settings.filter === "none" ||
        disposed ||
        !visible ||
        signal.aborted ||
        !context
      )
        return;
      const generation = filterGeneration,
        controller = new AbortController();
      filterAbort = controller;
      const obsolete = () =>
        generation !== filterGeneration ||
        disposed ||
        controller.signal.aborted ||
        signal.aborted;
      let reported = false;
      const isReported = () => reported;
      const fail = () => {
        if (
          reported ||
          generation !== filterGeneration ||
          disposed ||
          controller.signal.aborted
        )
          return;
        reported = true;
        reportFilterStatus(
          `Couldn’t apply ${settings.filter === "none" ? "filter" : PAPER_IMAGE_FILTERS[settings.filter].name}. Showing Original.`,
        );
      };
      void (async () => {
        const { createImageFilter } = await import("./paper/images/adapter");
        if (obsolete()) return;
        const next = await createImageFilter(
          host,
          owned.image,
          settings,
          context,
          controller.signal,
          fail,
        );
        if (obsolete()) next.destroy();
        else {
          filter = next;
          next.configure(settings);
          next.update(context);
          if (!isReported()) reportFilterStatus("");
        }
      })().catch(fail);
    };
    signal.addEventListener("abort", stopFilter, { once: true });
    const mount = () => {
      owned.image.className = "local-image-background";
      owned.image.style.objectFit = settings.fit;
      owned.image.hidden = false;
      host.append(owned.image);
      preparedByHost.set(host, { assetId, image: owned });
    };
    mount();
    startFilter();
    const instance: LocalImageInstance = {
      configure(next) {
        const changed = settings.filter !== next.filter,
          fitChanged = settings.fit !== next.fit;
        settings = next;
        owned.image.style.objectFit = next.fit;
        if (changed) startFilter();
        else filter?.configure(next);
        if (fitChanged) this.resize();
      },
      update(next) {
        context = next;
        visible = next.visible;
        if (!visible) {
          resizeInvalidated = false;
          if (!filter)
            stopFilter(); // Cancel pending filter imports/decodes, retain completed matching GPU work warm.
          else filter.update(next);
        } else {
          filter?.update(next);
          if (!filter && settings.filter !== "none") startFilter();
        }
      },
      resize() {
        if (!isLive()) return;
        if (resizing) {
          resizeInvalidated = true;
          return;
        }
        resizeInvalidated = false;
        const target = displayDimensions(
          owned.metadata.width,
          owned.metadata.height,
          innerWidth,
          innerHeight,
          devicePixelRatio,
          settings.fit,
        );
        if (target.width <= owned.width && target.height <= owned.height)
          return;
        resizing = true;
        void (async () => {
          const asset = await images.assets.get(
            requiredValue(settings.assetId),
          );
          if (!asset || !isLive()) return;
          const next = await images.prepare(
            asset.original,
            settings.fit,
            signal,
          );
          if (!isLive()) {
            next.dispose();
            return;
          }
          const latest = displayDimensions(
            owned.metadata.width,
            owned.metadata.height,
            innerWidth,
            innerHeight,
            devicePixelRatio,
            settings.fit,
          );
          if (
            isResizeInvalidated() &&
            (latest.width > next.width || latest.height > next.height)
          ) {
            next.dispose();
            return;
          }
          stopFilter();
          owned.dispose();
          owned = next;
          mount();
          startFilter();
        })()
          .catch(() => {
            /* The current bounded original remains usable. */
          })
          .finally(() => {
            resizing = false;
            // One latest-target recheck per invalidation burst, not an allocation
            // loop until an uncapped viewport request is satisfied.
            if (resizeInvalidated) {
              resizeInvalidated = false;
              instance.resize();
            }
          });
      },
      destroy() {
        if (disposed) return;
        disposed = true;
        if (preparedByHost.get(host)?.image === owned)
          preparedByHost.delete(host);
        resizeInvalidated = false;
        stopFilter();
        signal.removeEventListener("abort", stopFilter);
        owned.dispose();
      },
    };
    return instance;
  } catch (error) {
    prepared?.dispose();
    throw error;
  }
}
