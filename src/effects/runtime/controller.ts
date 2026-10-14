import { requiredValue } from "./required-value";
import {
  DEFAULT_LOCAL_IMAGE,
  type LocalImageSettings,
} from "../../shared/local-image";
import type { PreparedLocalImage } from "../../platform/images/local-image-loading";
import {
  effectiveBackgroundConfig,
  type BackgroundId,
  type BackgroundOverrides,
} from "../../shared/background-metadata";
import {
  backgroundFailureMessage,
  backgroundFailureReason,
  backgroundFailureStatus,
  type BackgroundFailure,
  type BackgroundFailureStage,
} from "./failure";
import { ActiveInstanceSlot } from "./lifecycle";
import type {
  BackgroundControllerOptions,
  BackgroundStatus,
} from "./contracts";
import {
  backgroundLoaders,
  localImageLoader,
  type BackgroundLoader,
} from "./loaders";
export type { BackgroundLoader } from "./loaders";
import type { LocalImageAssetId } from "../../shared/local-image";
import type { BackgroundControllerState, ThemePalette } from "./contracts";

/** A cold mount may show the saved still preview, but only after this grace so a
 *  fast mount never flashes a still image before its first live frame. */
const PREVIEW_GRACE_MS = 250;

/** Inactivity pauses the selected renderer in place, retaining its last painted frame. */
export class BackgroundController {
  private readonly instances = new ActiveInstanceSlot();
  private hasInstance = false;
  private state: BackgroundControllerState | null = null;
  private generation = 0;
  private imageKey = "";
  private imageRevision = 0;
  private imageSettings: LocalImageSettings = DEFAULT_LOCAL_IMAGE;
  private episode = "";
  private mounting = false;
  private destroyed = false;
  private failure: BackgroundFailure | null = null;
  private lastFailure: BackgroundFailure | null = null;
  private retryUsed = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private cold = false;
  private preview: HTMLElement | undefined;
  private previewTimer: ReturnType<typeof setTimeout> | undefined;
  private imageFilter = "none";
  private imageAbort: AbortController | undefined;
  private readonly listeners = new Set<(status: BackgroundStatus) => void>();
  private painted = false;
  private thumbnailBorrower:
    ((id: LocalImageAssetId) => Promise<Blob> | undefined) | undefined;
  private readonly unsubscribeMotion: () => void;
  private readonly resizeObserver: ResizeObserver;
  private readonly activity: BackgroundControllerOptions["activity"];
  private readonly unsubscribeActivity: () => void;
  private readonly onMotion = () => {
    if (this.activity.isActive()) this.updateInstance();
  };
  private readonly onResize = () => {
    this.resizeInstance();
  };

  get diagnostic(): Readonly<BackgroundFailure> | null {
    return this.lastFailure && { ...this.lastFailure };
  }

  constructor(
    private readonly host: HTMLElement,
    private readonly options: BackgroundControllerOptions,
  ) {
    this.activity = options.activity;
    this.unsubscribeActivity = this.activity.subscribe((active) => {
      this.onActivity(active);
    });
    if (!this.activity.isActive()) this.onActivity(false);
    this.resizeObserver = new ResizeObserver(() => {
      this.resizeInstance();
    });
    this.resizeObserver.observe(host);
    this.unsubscribeMotion = options.subscribeReducedMotion(() => {
      this.onMotion();
    });
    window.addEventListener("resize", this.onResize);
  }

  current(): BackgroundStatus {
    return {
      id: this.state?.id ?? "none",
      active: !this.destroyed && this.activity.isActive(),
      ready: !this.state || this.state.id === "none" || this.painted,
      mounting: this.mounting,
      message: this.host.dataset.error ?? "",
      filterMessage: this.filterMessage,
      diagnostic: this.diagnostic,
    };
  }
  subscribe(listener: (status: BackgroundStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.current());
    return () => {
      this.listeners.delete(listener);
    };
  }
  borrowThumbnail(assetId: LocalImageAssetId): Promise<Blob> | undefined {
    return this.thumbnailBorrower?.(assetId);
  }
  isActive(): boolean {
    return !this.destroyed && this.activity.isActive();
  }
  private currentFailure() {
    return this.failure;
  }
  private hasCurrentInstance() {
    return this.hasInstance;
  }
  private isCurrent(generation: number, id: BackgroundId): boolean {
    return (
      generation === this.generation && !this.destroyed && this.state?.id === id
    );
  }
  private filterMessage = "";
  private publish(): void {
    const snapshot = this.current();
    for (const listener of [...this.listeners]) listener(snapshot);
  }

  async set(
    id: BackgroundId,
    overrides: BackgroundOverrides,
    palette: ThemePalette,
    localImage: LocalImageSettings = DEFAULT_LOCAL_IMAGE,
    revision = 0,
    candidate?: PreparedLocalImage,
  ): Promise<void> {
    if (this.destroyed) {
      candidate?.dispose();
      return;
    }
    const config = effectiveBackgroundConfig(id, overrides);
    const episode = JSON.stringify([id, config, palette]);
    const sameEpisode = episode === this.episode;
    this.episode = episode;
    const previousId = this.state?.id;
    const imageKey = String(localImage.assetId);
    if (
      previousId !== id ||
      (id === "local-image" && imageKey !== this.imageKey)
    )
      this.painted = false;
    this.state = { id, config, palette };
    this.imageSettings = localImage;
    this.imageRevision = revision;
    this.host.dataset.background = id;
    if (!sameEpisode) {
      this.cancelRecovery();
      this.retryUsed = false;
    }
    if (
      sameEpisode &&
      id !== "local-image" &&
      (this.failure || this.mounting)
    ) {
      candidate?.dispose();
      return;
    }
    if (!(
      id === "local-image" &&
      previousId === id &&
      this.imageFilter === localImage.filter &&
      this.host.dataset.error
    ))
      this.clearError();
    this.imageFilter = localImage.filter;
    if (!this.activity.isActive()) {
      candidate?.dispose();
      if (
        id !== previousId ||
        (id === "local-image" && imageKey !== this.imageKey)
      ) {
        this.releaseInstance();
        this.hidePreview();
        this.cold = true;
      }
      return;
    }
    if (
      previousId === id &&
      this.hasInstance &&
      (id !== "local-image" || imageKey === this.imageKey)
    ) {
      candidate?.dispose();
      if (id === "local-image") this.instances.configure(localImage);
      this.updateInstance();
      return;
    }
    this.releaseInstance();
    this.imageKey = imageKey;
    const generation = ++this.generation;
    this.host.replaceChildren();
    if (id === "none") {
      candidate?.dispose();
      this.cold = false;
      this.hidePreview();
      this.publish();
      return;
    }
    if (this.cold && id !== "local-image") {
      // A fallback that was already on screen stays; a fresh mount earns one.
      if (this.preview) this.showPreview(id);
      else this.showPreviewAfterGrace(id);
    }
    if (id === "local-image") {
      const imageAbort = new AbortController();
      this.imageAbort = imageAbort;
      this.mounting = true;
      this.publish();
      let ownedCandidate = candidate;
      try {
        const { createLocalImage, preparedImageThumbnail } = await (
          this.options.localImageLoader ?? localImageLoader
        )();
        if (!this.isCurrent(generation, id) || imageAbort.signal.aborted)
          return;
        const initialContext = {
          config,
          palette,
          reducedMotion: this.options.reducedMotion(),
          visible: this.activity.isActive(),
        };
        // The renderer owns disposal from the call onward, including rejected construction.
        const rendererCandidate = ownedCandidate;
        ownedCandidate = undefined;
        const instance = await createLocalImage(
          this.options.images,
          this.host,
          localImage,
          imageAbort.signal,
          rendererCandidate,
          initialContext,
          (message) => {
            if (generation === this.generation) {
              if (message) this.setError(message);
              else this.clearError();
              this.filterMessage = message;
              this.publish();
            }
          },
        );
        if (generation !== this.generation || !this.activity.isActive())
          instance.destroy();
        else {
          this.instances.replace(instance);
          this.hasInstance = true;
          this.thumbnailBorrower = (id) =>
            preparedImageThumbnail(this.host, id);
          this.painted = true;
          this.updateInstance();
          this.cold = false;
          this.publish();
        }
      } catch (error) {
        if (generation === this.generation && this.activity.isActive())
          this.setError(
            error instanceof Error
              ? error.message
              : "Saved image unavailable. Retry, replace or remove it.",
          );
      } finally {
        ownedCandidate?.dispose();
        if (generation === this.generation) {
          this.mounting = false;
          this.publish();
        }
      }
      return;
    }
    candidate?.dispose();
    await this.mount(generation);
  }

  /** Explicit retry uses current reconciled state, never a failed factory snapshot. */
  async retry(): Promise<void> {
    if (
      this.destroyed ||
      !this.failure ||
      this.failure.retry === "retrying" ||
      !this.state ||
      this.state.id === "none" ||
      this.state.id === "local-image"
    )
      return;
    this.cancelRetry();
    this.retryUsed = false;
    if (!this.activity.isActive()) {
      this.failure.retry = "deferred";
      this.publishFailure();
      return;
    }
    await this.retryCurrent();
  }

  private async mount(generation: number): Promise<void> {
    if (!this.state || !this.activity.isActive()) return;
    const { id } = this.state;
    const loaders: Partial<Record<BackgroundId, BackgroundLoader>> =
      this.options.loaders ?? backgroundLoaders;
    const loader = loaders[id];
    if (!loader) {
      this.fail(
        generation,
        id,
        new Error("This background is not available in this build."),
        "startup",
        "unavailable",
      );
      return;
    }
    this.mounting = true;
    this.publish();
    let stage: BackgroundFailureStage = "import";
    try {
      const { default: factory } = await loader();
      if (!this.isCurrent(generation, id) || !this.activity.isActive()) return;
      stage = "startup";
      const mount = document.createElement("div");
      mount.className = "background-mount";
      this.host.replaceChildren(mount, ...(this.preview ? [this.preview] : []));
      let adopted = false,
        painted = false;
      const isPainted = () => painted;
      const instance = await factory({
        host: mount,
        config: this.state.config,
        palette: this.state.palette,
        reducedMotion: this.options.reducedMotion(),
        visible: true,
        reportPaint: () => {
          if (
            generation !== this.generation ||
            this.destroyed ||
            !this.activity.isActive()
          )
            return;
          const canvas = mount.querySelector<HTMLCanvasElement>("canvas");
          if (canvas && (canvas.width <= 0 || canvas.height <= 0)) return;
          painted = true;
          if (adopted && !this.painted) {
            this.painted = true;
            this.hidePreview();
            this.publish();
          }
        },
        reportRuntimeFailure: (error) => {
          this.fail(generation, id, error, adopted ? "runtime" : "startup");
        },
      });
      if (!this.isCurrent(generation, id) || !this.activity.isActive())
        instance.destroy();
      else {
        this.instances.replace(instance);
        this.hasInstance = true;
        adopted = true;
        this.updateInstance();
        // update() can throw or synchronously report a runtime failure. In both
        // cases fail() invalidates this generation and installs a fallback; never
        // reveal or clear recovery state for that failed adoption.
        if (!this.isCurrent(generation, id) || !this.hasCurrentInstance())
          return;
        if (isPainted()) {
          this.painted = true;
          this.hidePreview();
        }
        this.cold = false;
        if (this.currentFailure()) {
          requiredValue(this.failure).retry = "recovered";
          this.lastFailure = { ...requiredValue(this.failure) };
        }
        this.failure = null;
        this.clearError();
      }
    } catch (error) {
      this.fail(generation, id, error, stage);
    } finally {
      if (generation === this.generation) {
        this.mounting = false;
        this.publish();
      }
    }
  }

  /** Public cancellation remains available for image replacement; normal inactivity retains completed images. */
  invalidateImage(): void {
    if (this.state?.id !== "local-image") return;
    this.releaseInstance();
    this.generation++;
    this.state = null;
    this.host.replaceChildren();
    this.hidePreview();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelRecovery();
    this.generation++;
    this.releaseInstance();
    this.resizeObserver.disconnect();
    this.unsubscribeActivity();
    this.unsubscribeMotion();
    window.removeEventListener("resize", this.onResize);
    this.host.replaceChildren();
    this.hidePreview();
    this.state = null;
    this.clearError();
    this.listeners.clear();
  }

  private onActivity(active: boolean): void {
    this.publish();
    if (this.destroyed) return;
    if (!active) {
      // In-flight imports/decodes must not adopt after inactivity. Completed matching instances retain their last frame.
      if (
        this.mounting ||
        (this.state?.id === "local-image" && !this.hasInstance)
      ) {
        this.generation++;
        this.imageAbort?.abort();
        this.mounting = false;
        this.cold = true;
        if (
          this.state?.id &&
          this.state.id !== "none" &&
          this.state.id !== "local-image"
        )
          this.showPreview(this.state.id);
        // Detach a staging mount so an awaited Paper noise decode cannot allocate a GL context.
        if (!this.hasInstance)
          this.host.replaceChildren(...(this.preview ? [this.preview] : []));
      }
      if (
        this.failure &&
        (this.failure.retry === "scheduled" ||
          this.failure.retry === "retrying")
      ) {
        this.cancelRetry();
        this.failure.retry = "deferred";
        this.publishFailure();
      }
      this.updateInstance();
      this.publish();
      return;
    }
    if (this.failure?.retry === "deferred") {
      this.scheduleRetry();
      return;
    }
    if (!this.state) return;
    if (this.hasInstance) {
      if (this.state.id === "local-image")
        this.instances.configure(this.imageSettings);
      this.updateInstance();
      this.resizeInstance();
    } else if (!this.failure) {
      // The old async result is invalid; mount only the newest state.
      if (this.state.id === "none") {
        this.hidePreview();
        return;
      }
      this.cold = true;
      void this.set(
        this.state.id,
        { [this.state.id]: this.state.config },
        this.state.palette,
        this.imageSettings,
        this.imageRevision,
      );
    }
  }

  private releaseInstance(): void {
    this.thumbnailBorrower = undefined;
    this.painted = false;
    this.imageAbort?.abort();
    this.imageAbort = undefined;
    this.instances.clear();
    this.hasInstance = false;
  }
  private showPreviewAfterGrace(id: BackgroundId): void {
    this.cancelPreviewTimer();
    this.previewTimer = setTimeout(() => {
      this.previewTimer = undefined;
      if (this.destroyed || this.painted || this.preview) return;
      this.showPreview(id);
    }, PREVIEW_GRACE_MS);
  }
  private cancelPreviewTimer(): void {
    if (this.previewTimer === undefined) return;
    clearTimeout(this.previewTimer);
    this.previewTimer = undefined;
  }
  private showPreview(id: BackgroundId): void {
    this.hidePreview();
    const preview = document.createElement("div");
    preview.className = "background-preview";
    preview.setAttribute("aria-hidden", "true");
    const url = this.options.resolveAsset(`previews/${id}.webp`);
    preview.style.backgroundImage = `url("${url}")`;
    this.preview = preview;
    this.host.append(preview);
  }
  private hidePreview(): void {
    this.cancelPreviewTimer();
    this.preview?.remove();
    this.preview = undefined;
  }
  private clearError(): void {
    this.filterMessage = "";
    this.host.removeAttribute("data-error");
    if (this.options.statusElement) this.options.statusElement.textContent = "";
    this.options.onFailure?.(null);
    this.publish();
  }
  private setError(message: string): void {
    this.host.dataset.error = message;
    if (this.options.statusElement)
      this.options.statusElement.textContent = message;
    this.publish();
  }
  private updateInstance(): void {
    if (!this.hasInstance || !this.state) return;
    const { id } = this.state,
      generation = this.generation;
    try {
      this.instances.update({
        config: this.state.config,
        palette: this.state.palette,
        reducedMotion: this.options.reducedMotion(),
        visible: this.activity.isActive(),
      });
    } catch (error) {
      this.fail(generation, id, error, "update");
    }
  }
  private resizeInstance(): void {
    if (!this.activity.isActive() || !this.hasInstance || !this.state) return;
    const { id } = this.state,
      generation = this.generation;
    try {
      this.instances.resize();
    } catch (error) {
      this.fail(generation, id, error, "resize");
    }
  }
  private cancelRetry(): void {
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }
  private cancelRecovery(): void {
    this.cancelRetry();
    if (this.failure)
      this.lastFailure = { ...this.failure, retry: "cancelled" };
    this.failure = null;
  }
  private publishFailure(): void {
    if (!this.failure) return;
    this.lastFailure = { ...this.failure };
    this.setError(backgroundFailureStatus(this.failure));
    this.options.onFailure?.({ ...this.failure });
  }
  private scheduleRetry(): void {
    if (!this.failure || this.destroyed) return;
    this.cancelRetry();
    this.failure.retry = this.activity.isActive() ? "scheduled" : "deferred";
    this.publishFailure();
    if (!this.activity.isActive()) return;
    const generation = this.generation;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      if (generation !== this.generation || this.destroyed) return;
      if (!this.activity.isActive()) {
        if (this.failure) this.failure.retry = "deferred";
        this.publishFailure();
        return;
      }
      void this.retryCurrent();
    }, 1000);
  }
  private async retryCurrent(): Promise<void> {
    if (!this.failure) return;
    this.failure.retry = "retrying";
    this.publishFailure();
    await this.mount(++this.generation);
  }
  private fail(
    generation: number,
    id: BackgroundId,
    error: unknown,
    stage: BackgroundFailureStage,
    explicitReason?: BackgroundFailure["reason"],
  ): void {
    if (this.destroyed || !this.isCurrent(generation, id)) return;
    if (id === "local-image") {
      this.setError(backgroundFailureMessage(error));
      return;
    }
    this.generation++;
    this.cancelRetry();
    this.mounting = false;
    this.hasInstance = false;
    this.painted = false;
    const message = backgroundFailureMessage(error);
    const reason = explicitReason ?? backgroundFailureReason(stage, message);
    console.error(`Background ${id} failed (${stage}/${reason}): ${message}`);
    this.instances.clear();
    if (!this.preview) this.showPreview(id);
    this.host.replaceChildren(...(this.preview ? [this.preview] : []));
    this.failure = {
      id,
      stage,
      reason,
      message,
      time: Date.now(),
      retry: "stopped",
    };
    if (
      !this.retryUsed &&
      (stage === "runtime" || stage === "update" || stage === "resize") &&
      (reason === "render" || reason === "context-lost")
    ) {
      this.retryUsed = true;
      this.scheduleRetry();
    } else this.publishFailure();
  }
}
