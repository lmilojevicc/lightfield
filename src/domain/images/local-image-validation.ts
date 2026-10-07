import { requiredValue } from "../required-value";
export const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 24_000_000;
export const MAX_IMAGE_EDGE = 16_384;
export interface LocalImageMetadata {
  mime: "image/jpeg" | "image/png" | "image/webp";
  bytes: number;
  width: number;
  height: number;
  orientation: number;
}
const invalid = () =>
  new Error("Couldn’t read this image. Use a still JPEG, PNG or WebP.");
const animation = () =>
  new Error("Animated images are unsupported. Use a still JPEG, PNG or WebP.");
/** Bounds-checked TIFF orientation only; never follows arbitrary offsets recursively. */
function exifOrientation(bytes: Uint8Array): number {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 8) throw invalid();
  const little = v.getUint16(0) === 0x4949;
  if (!little && v.getUint16(0) !== 0x4d4d) throw invalid();
  if (v.getUint16(2, little) !== 42) throw invalid();
  const offset = v.getUint32(4, little);
  if (offset < 8 || offset + 2 > bytes.length) throw invalid();
  const count = v.getUint16(offset, little);
  if (count > 4096 || offset + 2 + count * 12 + 4 > bytes.length)
    throw invalid();
  let orientation = 1;
  for (let i = 0; i < count; i++) {
    const p = offset + 2 + i * 12;
    if (v.getUint16(p, little) !== 0x112) continue;
    if (v.getUint16(p + 2, little) !== 3 || v.getUint32(p + 4, little) !== 1)
      throw invalid();
    orientation = v.getUint16(p + 8, little);
    if (orientation < 1 || orientation > 8) throw invalid();
  }
  return orientation;
}
export function validateImageBytes(
  bytes: Uint8Array,
  declaredMime = "",
): LocalImageMetadata {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES)
    throw new Error(
      "This image exceeds the supported size (32 MiB, 24 megapixels, 16,384 pixels per side).",
    );
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (p: number, n: number) =>
    String.fromCharCode(...bytes.subarray(p, p + n));
  let mime: LocalImageMetadata["mime"],
    width = 0,
    height = 0,
    orientation = 1;
  if (bytes.length >= 8 && text(0, 8) === "\x89PNG\r\n\x1a\n") {
    mime = "image/png";
    let p = 8,
      chunks = 0,
      ended = false,
      data = false;
    while (p < bytes.length) {
      if (++chunks > 100_000 || p + 12 > bytes.length) throw invalid();
      const length = v.getUint32(p),
        type = text(p + 4, 4),
        end = p + 12 + length;
      if (end > bytes.length || !/^[A-Za-z]{4}$/.test(type)) throw invalid();
      if (chunks === 1 && (type !== "IHDR" || length !== 13)) throw invalid();
      if (type === "IHDR") {
        if (chunks !== 1) throw invalid();
        width = v.getUint32(p + 8);
        height = v.getUint32(p + 12);
        const depth = requiredValue(bytes[p + 16]),
          color = requiredValue(bytes[p + 17]);
        if (
          !(
            {
              0: [1, 2, 4, 8, 16],
              2: [8, 16],
              3: [1, 2, 4, 8],
              4: [8, 16],
              6: [8, 16],
            } as Record<number, number[]>
          )[color]?.includes(depth) ||
          bytes[p + 18] !== 0 ||
          bytes[p + 19] !== 0 ||
          requiredValue(bytes[p + 20]) > 1
        )
          throw invalid();
      }
      if (type === "acTL" || type === "fcTL" || type === "fdAT")
        throw animation();
      if (type === "eXIf")
        orientation = exifOrientation(bytes.subarray(p + 8, end - 4));
      if (type === "IDAT") data = true;
      if (type === "IEND") {
        if (length !== 0 || end !== bytes.length) throw invalid();
        ended = true;
      }
      p = end;
    }
    if (!ended || !data) throw invalid();
  } else if (
    bytes.length >= 12 &&
    text(0, 4) === "RIFF" &&
    text(8, 4) === "WEBP"
  ) {
    mime = "image/webp";
    if (v.getUint32(4, true) + 8 !== bytes.length) throw invalid();
    let p = 12,
      chunks = 0,
      data = false,
      canvasWidth = 0,
      canvasHeight = 0;
    const u24 = (p: number) =>
      requiredValue(bytes[p]) +
      requiredValue(bytes[p + 1]) * 256 +
      requiredValue(bytes[p + 2]) * 65536;
    while (p < bytes.length) {
      if (++chunks > 100_000 || p + 8 > bytes.length) throw invalid();
      const type = text(p, 4),
        length = v.getUint32(p + 4, true),
        start = p + 8,
        end = start + length;
      if (end + (length % 2) > bytes.length) throw invalid();
      if (type === "ANIM" || type === "ANMF") throw animation();
      if (type === "VP8X") {
        if (chunks !== 1 || length !== 10) throw invalid();
        if (requiredValue(bytes[start]) & 2) throw animation();
        canvasWidth = u24(start + 4) + 1;
        canvasHeight = u24(start + 7) + 1;
      }
      if (type === "VP8 " || type === "VP8L") {
        if (data) throw invalid();
        data = true;
        if (type === "VP8 ") {
          if (
            length < 10 ||
            requiredValue(bytes[start]) & 1 ||
            text(start + 3, 3) !== "\x9d\x01\x2a"
          )
            throw invalid();
          width = v.getUint16(start + 6, true) & 0x3fff;
          height = v.getUint16(start + 8, true) & 0x3fff;
        } else {
          if (
            length < 5 ||
            bytes[start] !== 0x2f ||
            requiredValue(bytes[start + 4]) >> 5
          )
            throw invalid();
          const bits = v.getUint32(start + 1, true);
          width = (bits & 0x3fff) + 1;
          height = ((bits >>> 14) & 0x3fff) + 1;
        }
      }
      if (type === "EXIF") {
        const skip = text(start, 6) === "Exif\0\0" ? 6 : 0;
        orientation = exifOrientation(bytes.subarray(start + skip, end));
      }
      p = end + (length % 2);
    }
    if (
      !data ||
      (canvasWidth && (canvasWidth !== width || canvasHeight !== height))
    )
      throw invalid();
  } else if (bytes.length >= 4 && v.getUint16(0) === 0xffd8) {
    mime = "image/jpeg";
    if (v.getUint16(bytes.length - 2) !== 0xffd9) throw invalid();
    let p = 2,
      segments = 0,
      scanned = false;
    while (p < bytes.length - 2) {
      if (++segments > 100_000 || bytes[p++] !== 0xff) throw invalid();
      while (bytes[p] === 0xff) {
        if (++p >= bytes.length) throw invalid();
      }
      const marker = requiredValue(bytes[p++]);
      if (
        p + 2 > bytes.length ||
        marker === 0 ||
        marker === 0xd8 ||
        marker === 0xd9
      )
        throw invalid();
      const length = v.getUint16(p),
        end = p + length;
      if (length < 2 || end > bytes.length) throw invalid();
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (length < 8 || width) throw invalid();
        height = v.getUint16(p + 3);
        width = v.getUint16(p + 5);
        if (bytes[p + 2] !== 8) throw invalid();
      } else if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        ![0xc4, 0xc8, 0xcc].includes(marker)
      )
        throw invalid();
      if (marker === 0xe1 && length >= 8 && text(p + 2, 6) === "Exif\0\0")
        orientation = exifOrientation(bytes.subarray(p + 8, end));
      if (marker === 0xda) {
        if (length < 6) throw invalid();
        scanned = true;
        break;
      }
      p = end;
    }
    if (!scanned) throw invalid();
  } else
    throw new Error(
      "Use a still JPEG, PNG or WebP. SVG, GIF and other formats are unsupported.",
    );
  if (declaredMime && declaredMime.toLowerCase() !== mime)
    throw new Error("The image type does not match its file contents.");
  if (!width || !height) throw invalid();
  if (
    width > MAX_IMAGE_EDGE ||
    height > MAX_IMAGE_EDGE ||
    width * height > MAX_IMAGE_PIXELS
  )
    throw new Error(
      "This image exceeds the supported size (32 MiB, 24 megapixels, 16,384 pixels per side).",
    );
  return {
    mime,
    bytes: bytes.length,
    width: orientation >= 5 ? height : width,
    height: orientation >= 5 ? width : height,
    orientation,
  };
}
export async function validateLocalImage(
  blob: Blob,
): Promise<LocalImageMetadata> {
  if (!blob.size || blob.size > MAX_IMAGE_BYTES)
    throw new Error("Choose an image up to 32 MiB.");
  return validateImageBytes(
    new Uint8Array(await blob.arrayBuffer()),
    blob.type,
  );
}
