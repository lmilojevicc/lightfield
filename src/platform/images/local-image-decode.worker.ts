import { imageOrientationTransform } from "../../domain/images/local-image-orientation";
// A dedicated, one-job worker is terminated after completion/cancellation/deadline.
// Browser codec scratch is not guaranteed bounded by resizeWidth/resizeHeight.
self.onmessage = async (
  event: MessageEvent<{
    blob: Blob;
    width: number;
    height: number;
    orientation: number;
  }>,
) => {
  let bitmap: ImageBitmap | undefined;
  let canvas: OffscreenCanvas | undefined;
  try {
    const { blob, width, height, orientation } = event.data;
    bitmap = await createImageBitmap(blob, {
      imageOrientation: "from-image",
      resizeWidth: orientation >= 5 ? height : width,
      resizeHeight: orientation >= 5 ? width : height,
      resizeQuality: "high",
    });
    canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image preparation is unavailable.");
    context.setTransform(
      ...imageOrientationTransform(orientation, width, height),
    );
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    bitmap = undefined;
    const derivative = await canvas.convertToBlob({ type: "image/png" });
    self.postMessage({ blob: derivative });
  } catch {
    self.postMessage({ error: "Couldn’t decode this image." });
  } finally {
    bitmap?.close();
    if (canvas) canvas.width = canvas.height = 0;
  }
};
export {};
