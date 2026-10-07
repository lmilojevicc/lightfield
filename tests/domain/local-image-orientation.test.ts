import { test, expect } from "bun:test";
import { validateImageBytes } from "../../src/domain/images/local-image-validation";
import {
  imageDecodeBlob,
  imageOrientationTransform,
} from "../../src/domain/images/local-image-orientation";
for (const format of ["jpg", "png", "webp"])
  for (let orientation = 1; orientation <= 8; orientation++) {
    test(`local-image-orientation strips ${format} EXIF ${String(orientation)} only from decode copy`, async () => {
      const original = await Bun.file(
        new URL(
          `../fixtures/images/orientation-${String(orientation)}.${format}`,
          import.meta.url,
        ),
      ).arrayBuffer();
      const bytes = new Uint8Array(original),
        metadata = validateImageBytes(bytes);
      const blob = new Blob([original], { type: metadata.mime });
      const decoded = new Uint8Array(
        await imageDecodeBlob(blob, bytes, metadata.mime).arrayBuffer(),
      );
      expect(validateImageBytes(decoded).orientation).toBe(1);
      expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
      const matrix = imageOrientationTransform(
        orientation,
        metadata.width,
        metadata.height,
      );
      expect(matrix).toHaveLength(6);
      expect(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2])).toBe(1);
    });
  }
