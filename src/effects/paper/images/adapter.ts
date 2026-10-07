// Reuses the sole audited Paper mount. HTMLImage/URL ownership stays with callers.
import { getShaderNoiseTexture } from "@paper-design/shaders";
import { ShaderMount } from "../shader-mount";
import {
  effectiveImageFilter,
  PAPER_IMAGE_FILTERS,
  type PaperImageFilterId,
} from "../../../shared/image-filter-metadata";
import { imageFilterUniforms } from "./uniforms";
import type { LocalImageSettings } from "../../../shared/local-image";
import type {
  BackgroundInstance,
  BackgroundUpdateContext,
} from "../../runtime/contracts";

export const imageFilterLoaders = {
  "paper-image-paper-texture": () => import("./paper-texture"),
  "paper-image-fluted-glass": () => import("./fluted-glass"),
  "paper-image-water": () => import("./water"),
  "paper-image-image-dithering": () => import("./image-dithering"),
  "paper-image-halftone-dots": () => import("./halftone-dots"),
  "paper-image-halftone-cmyk": () => import("./halftone-cmyk"),
  "paper-image-lens-distortion": () => import("./lens-distortion"),
};
export interface ImageFilterInstance extends BackgroundInstance {
  configure(settings: LocalImageSettings): void;
}
export function filterTextureDimensions(
  width: number,
  height: number,
  limit: number,
) {
  if (![width, height, limit].every((n) => Number.isFinite(n) && n >= 1))
    throw new Error("Invalid filter texture dimensions");
  const scale = Math.min(
    1,
    limit / width,
    limit / height,
    Math.sqrt(2073600 / (width * height)),
  );
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

export async function createImageFilter(
  parent: HTMLElement,
  original: HTMLImageElement,
  initial: LocalImageSettings,
  context: BackgroundUpdateContext,
  signal: AbortSignal,
  report: (error: unknown) => void,
): Promise<ImageFilterInstance> {
  const id = initial.filter as PaperImageFilterId,
    definition = PAPER_IMAGE_FILTERS[id];
  let settings = initial,
    state = context,
    mount: ShaderMount | undefined,
    noise: HTMLImageElement | undefined;
  let derived: HTMLImageElement | undefined,
    url: string | undefined,
    disposed = false,
    failed: unknown;
  const host = document.createElement("div");
  host.className = "paper-image-overlay";
  host.style.visibility = "hidden";
  host.setAttribute("aria-hidden", "true");
  const destroy = () => {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener("abort", destroy);
    mount?.dispose();
    mount = undefined;
    host.remove();
    noise?.removeAttribute("src");
    noise = undefined;
    derived?.removeAttribute("src");
    derived = undefined;
    if (url) URL.revokeObjectURL(url);
    url = undefined;
  };
  const live = () => {
    if (disposed || signal.aborted || document.hidden || !parent.isConnected)
      throw new Error("Image filter cancelled");
  };
  signal.addEventListener("abort", destroy, { once: true });
  const failure = () => failed;
  const isDisposed = () => disposed;
  const fail = (error: unknown) => {
    if (disposed) return;
    failed = error;
    destroy();
    report(error);
  };
  const speed = () =>
    mount?.setSpeed(
      id === "paper-image-water" && state.visible && !state.reducedMotion
        ? Number(effectiveImageFilter(id, settings.filterOverrides).speed)
        : 0,
    );
  try {
    live();
    const { fragment } = await imageFilterLoaders[id]();
    live();
    if (definition.noise) {
      noise = getShaderNoiseTexture();
      if (!noise) throw new Error("Paper noise unavailable");
      await noise.decode();
      live();
    }
    parent.append(host);
    // Hidden synchronous first paint with undefined image discovers THIS context's caps.
    // A second checked setUniforms paint must succeed before the overlay is displayed.
    mount = new ShaderMount(
      host,
      fragment,
      imageFilterUniforms(id, settings, undefined, noise, state.palette),
      { alpha: true, antialias: false, powerPreference: "low-power" },
      0,
      0,
      1,
      2073600,
      [...definition.mipmaps],
      fail,
      1.5,
    );
    const size = filterTextureDimensions(
      original.naturalWidth,
      original.naturalHeight,
      mount.getTextureLimit(),
    );
    let image = original;
    if (
      size.width !== original.naturalWidth ||
      size.height !== original.naturalHeight
    ) {
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      try {
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Filter resize unavailable");
        // Source is already EXIF-oriented by the image worker. Never transform again.
        ctx.drawImage(original, 0, 0, size.width, size.height);
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((b) => {
            if (b) resolve(b);
            else reject(new Error("Filter resize failed"));
          }, "image/png");
        });
        live();
        url = URL.createObjectURL(blob);
        derived = new Image();
        derived.src = url;
        await derived.decode();
        live();
        image = derived;
      } finally {
        canvas.width = canvas.height = 0;
      }
    }
    live();
    mount.setUniforms({ u_image: image });
    if (failure() || isDisposed()) {
      const error = failure();
      throw error instanceof Error
        ? error
        : new Error("Image filter cancelled");
    }
    host.dataset.paperImageReady = id;
    host.style.visibility = "";
    speed();
    return {
      configure(next) {
        settings = next;
        if (state.visible)
          mount?.setUniforms(
            imageFilterUniforms(id, settings, image, noise, state.palette),
          );
        speed();
      },
      update(next) {
        const changed =
          JSON.stringify(state.palette) !== JSON.stringify(next.palette);
        const wasVisible = state.visible;
        state = next;
        speed();
        if (!next.visible) {
          mount?.setPaintEnabled(false);
          return;
        }
        if (changed || !wasVisible)
          mount?.setUniforms(
            imageFilterUniforms(id, settings, image, noise, state.palette),
          );
        mount?.setPaintEnabled(true);
      },
      resize() {},
      destroy,
    };
  } catch (error) {
    destroy();
    throw error;
  }
}
