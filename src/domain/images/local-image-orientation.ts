import { requiredValue } from "../required-value";
import type { LocalImageMetadata } from "./local-image-validation";
/** Decode copies omit EXIF so JPEG/PNG/WebP browser differences cannot apply it twice.
 * Slices reference encoded bytes; the retained original is never rewritten.
 * Call only after full bounded header validation.
 */
export function imageDecodeBlob(
  original: Blob,
  bytes: Uint8Array,
  mime: LocalImageMetadata["mime"],
): Blob {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (p: number, length: number) =>
    String.fromCharCode(...bytes.subarray(p, p + length));
  const omit: [number, number][] = [];
  if (mime === "image/jpeg") {
    let p = 2;
    while (p < bytes.length - 2) {
      const start = p++;
      while (bytes[p] === 0xff) p++;
      const marker = requiredValue(bytes[p++]);
      const length = view.getUint16(p),
        end = p + length;
      if (marker === 0xe1 && text(p + 2, 6) === "Exif\0\0")
        omit.push([start, end]);
      if (marker === 0xda) break;
      p = end;
    }
  } else {
    let p = mime === "image/png" ? 8 : 12;
    while (p < bytes.length) {
      const png = mime === "image/png";
      const length = view.getUint32(p + (png ? 0 : 4), !png);
      const end = p + length + (png ? 12 : 8 + (length % 2));
      if (text(p + (png ? 4 : 0), 4) === (png ? "eXIf" : "EXIF"))
        omit.push([p, end]);
      p = end;
    }
  }
  if (!omit.length) return original.slice(0, original.size, mime);
  const parts: BlobPart[] = [];
  let from = 0;
  if (mime === "image/webp") {
    const header = bytes.slice(0, 12);
    new DataView(header.buffer).setUint32(
      4,
      bytes.length - omit.reduce((sum, [a, b]) => sum + b - a, 0) - 8,
      true,
    );
    parts.push(header);
    from = 12;
    if (text(12, 4) === "VP8X") {
      parts.push(
        original.slice(12, 20),
        new Uint8Array([requiredValue(bytes[20]) & ~8]),
      );
      from = 21;
    }
  }
  for (const [start, end] of omit) {
    parts.push(original.slice(from, start));
    from = end;
  }
  parts.push(original.slice(from));
  return new Blob(parts, { type: mime });
}
export function imageOrientationTransform(
  orientation: number,
  width: number,
  height: number,
): [number, number, number, number, number, number] {
  switch (orientation) {
    case 2:
      return [-1, 0, 0, 1, width, 0];
    case 3:
      return [-1, 0, 0, -1, width, height];
    case 4:
      return [1, 0, 0, -1, 0, height];
    case 5:
      return [0, 1, 1, 0, 0, 0];
    case 6:
      return [0, 1, -1, 0, width, 0];
    case 7:
      return [0, -1, -1, 0, width, height];
    case 8:
      return [0, -1, 1, 0, 0, height];
    default:
      return [1, 0, 0, 1, 0, 0];
  }
}
