import { requiredValue } from "../../domain/required-value";
import {
  imageDecodeBlob,
  imageOrientationTransform,
} from "../../domain/images/local-image-orientation";
import {
  displayDimensions,
  DISPLAY_PIXEL_BUDGET,
} from "../../domain/images/local-image-geometry";
import {
  validateImageBytes,
  MAX_IMAGE_BYTES,
  type LocalImageMetadata,
} from "../../domain/images/local-image-validation";
export interface PreparedLocalImage {
  readonly image: HTMLImageElement;
  readonly metadata: LocalImageMetadata;
  readonly width: number;
  readonly height: number;
  /** Detaches every DOM consumer before revoking the unique per-document URL. Idempotent. */
  dispose(): void;
}
export function createImagePreparer() {
  let cancelCurrent: (() => void) | undefined;
  async function prepareLocalImage(
    blob: Blob,
    fit: "cover" | "contain",
    signal?: AbortSignal,
    thumbnail = false,
  ): Promise<PreparedLocalImage> {
    if (document.hidden || signal?.aborted)
      throw new Error("Image preparation cancelled or timed out. Try again.");
    if (!thumbnail) cancelCurrent?.();
    const controller = new AbortController();
    const cancel = () => {
      controller.abort();
    };
    if (!thumbnail) cancelCurrent = cancel;
    const timeout = setTimeout(cancel, 15_000);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    let worker: Worker | undefined,
      url: string | undefined,
      image: HTMLImageElement | undefined;
    const check = () => {
      if (controller.signal.aborted || document.hidden)
        throw new Error("Image preparation cancelled or timed out. Try again.");
    };
    try {
      if (!blob.size || blob.size > MAX_IMAGE_BYTES)
        throw new Error("Choose an image up to 32 MiB.");
      let bytes: Uint8Array | undefined = new Uint8Array(
        await blob.arrayBuffer(),
      );
      check();
      const metadata = validateImageBytes(bytes, blob.type);
      const decodeBlob = imageDecodeBlob(blob, bytes, metadata.mime);
      bytes = undefined;
      const size = thumbnail
        ? displayDimensions(
            metadata.width,
            metadata.height,
            144,
            96,
            1,
            "contain",
          )
        : displayDimensions(
            metadata.width,
            metadata.height,
            innerWidth,
            innerHeight,
            devicePixelRatio,
            fit,
          );
      let displayBlob: Blob;
      if (
        typeof Worker !== "undefined" &&
        typeof OffscreenCanvas !== "undefined" &&
        typeof createImageBitmap === "function"
      ) {
        displayBlob = await new Promise<Blob>((resolve, reject) => {
          worker = new Worker(
            new URL("./local-image-decode.worker.ts", import.meta.url),
            { type: "module" },
          );
          controller.signal.addEventListener(
            "abort",
            () => {
              worker?.terminate();
              reject(
                new Error(
                  "Image preparation cancelled or timed out. Try again.",
                ),
              );
            },
            { once: true },
          );
          worker.onmessage = (event: MessageEvent<unknown>) => {
            const data = event.data;
            if (
              data &&
              typeof data === "object" &&
              "blob" in data &&
              data.blob instanceof Blob
            )
              resolve(data.blob);
            else reject(new Error("Couldn’t decode this image."));
          };
          worker.onerror = () => {
            reject(new Error("Couldn’t prepare this image."));
          };
          worker.postMessage({
            blob: decodeBlob,
            ...size,
            orientation: metadata.orientation,
          });
        });
        worker?.terminate();
        worker = undefined;
      } else {
        if (metadata.width * metadata.height > DISPLAY_PIXEL_BUDGET)
          throw new Error(
            "This browser cannot safely prepare this large image.",
          );
        // Main fallback is restricted to an already-within-budget source and applies the same transform.
        const source = new Image(),
          sourceUrl = URL.createObjectURL(decodeBlob);
        const canvas = document.createElement("canvas");
        try {
          source.src = sourceUrl;
          await Promise.race([
            source.decode(),
            new Promise<never>((_, reject) => {
              controller.signal.addEventListener(
                "abort",
                () => {
                  reject(
                    new Error("Image preparation cancelled or timed out."),
                  );
                },
                { once: true },
              );
            }),
          ]);
          check();
          const rawWidth =
            metadata.orientation >= 5 ? metadata.height : metadata.width;
          const rawHeight =
            metadata.orientation >= 5 ? metadata.width : metadata.height;
          if (
            source.naturalWidth !== rawWidth ||
            source.naturalHeight !== rawHeight
          )
            throw new Error(
              "The decoded image dimensions do not match its header.",
            );
          canvas.width = size.width;
          canvas.height = size.height;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Image preparation is unavailable.");
          context.setTransform(
            ...imageOrientationTransform(
              metadata.orientation,
              size.width,
              size.height,
            ),
          );
          context.drawImage(
            source,
            0,
            0,
            metadata.orientation >= 5 ? size.height : size.width,
            metadata.orientation >= 5 ? size.width : size.height,
          );
          displayBlob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((value) => {
              if (value) resolve(value);
              else reject(new Error("Couldn’t prepare this image."));
            }, "image/png");
          });
        } finally {
          source.removeAttribute("src");
          URL.revokeObjectURL(sourceUrl);
          canvas.width = canvas.height = 0;
        }
      }
      check();
      image = new Image();
      image.alt = "";
      image.decoding = "async";
      url = URL.createObjectURL(displayBlob);
      image.src = url;
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          reject(
            new Error("Image preparation cancelled or timed out. Try again."),
          );
        };
        controller.signal.addEventListener("abort", abort, { once: true });
        requiredValue(image)
          .decode()
          .then(resolve, () => {
            reject(new Error("Couldn’t decode this image."));
          })
          .finally(() => {
            controller.signal.removeEventListener("abort", abort);
          });
      });
      check();
      const expected = size;
      // Both decode paths produce this integer, already-oriented target. Aspect
      // tolerances reject valid thin panoramas and can admit an incorrect rotation.
      if (
        image.naturalWidth * image.naturalHeight > DISPLAY_PIXEL_BUDGET ||
        !image.naturalWidth ||
        !image.naturalHeight
      )
        throw new Error("The decoded image exceeds the display budget.");
      if (
        image.naturalWidth !== expected.width ||
        image.naturalHeight !== expected.height
      )
        throw new Error("The decoded image orientation is unsupported.");
      const ownedImage = image,
        ownedUrl = url;
      let disposed = false;
      return {
        image,
        metadata,
        width: image.naturalWidth,
        height: image.naturalHeight,
        dispose() {
          if (disposed) return;
          disposed = true;
          ownedImage.remove();
          ownedImage.removeAttribute("src");
          URL.revokeObjectURL(ownedUrl);
        },
      };
    } catch (error) {
      image?.remove();
      image?.removeAttribute("src");
      if (url) URL.revokeObjectURL(url);
      throw error;
    } finally {
      worker?.terminate();
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
      if (cancelCurrent === cancel) cancelCurrent = undefined;
    }
  }

  return prepareLocalImage;
}
export const prepareLocalImage = createImagePreparer();

/** Independent, explicitly visible UI request: never cancels the background decoder. */
export function prepareLocalImageThumbnail(
  blob: Blob,
  signal: AbortSignal,
): Promise<PreparedLocalImage> {
  return prepareLocalImage(blob, "contain", signal, true);
}

/** Borrow decoded pixels synchronously; only the tiny Blob crosses ownership. */
export async function thumbnailFromPrepared(
  prepared: PreparedLocalImage,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  const size = displayDimensions(
    prepared.width,
    prepared.height,
    144,
    96,
    1,
    "contain",
  );
  canvas.width = size.width;
  canvas.height = size.height;
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Thumbnail unavailable.");
    context.drawImage(prepared.image, 0, 0, size.width, size.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Thumbnail unavailable."));
      }, "image/png");
    });
  } finally {
    canvas.width = canvas.height = 0;
  }
}
