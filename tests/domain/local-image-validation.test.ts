import { test, expect } from "bun:test";
import {
  validateImageBytes,
  MAX_IMAGE_BYTES,
} from "../../src/domain/images/local-image-validation";
const fixture = async (name: string) =>
  new Uint8Array(
    await Bun.file(
      new URL(`../fixtures/images/${name}`, import.meta.url),
    ).arrayBuffer(),
  );
for (const [name, mime] of [
  ["alpha.png", "image/png"],
  ["still.jpg", "image/jpeg"],
  ["still.webp", "image/webp"],
] as const) {
  test(`local-image-validation ${name}: allow exact signature and empty MIME`, async () => {
    const bytes = await fixture(name);
    expect(validateImageBytes(bytes).mime).toBe(mime);
    expect(validateImageBytes(bytes, mime).width).toBe(320);
    expect(() => validateImageBytes(bytes, "image/gif")).toThrow(
      "does not match",
    );
    for (const length of [0, 1, 7, 16, 32, bytes.length - 1])
      expect(() => validateImageBytes(bytes.slice(0, length), mime)).toThrow();
  });
}
for (let orientation = 1; orientation <= 8; orientation++)
  test(`local-image-validation EXIF orientation ${String(orientation)}`, async () => {
    const metadata = validateImageBytes(
      await fixture(`orientation-${String(orientation)}.jpg`),
    );
    expect(metadata.orientation).toBe(orientation);
    expect([metadata.width, metadata.height]).toEqual(
      orientation >= 5 ? [200, 320] : [320, 200],
    );
  });
test("local-image-validation rejects animated PNG, malicious lengths, huge pixels, unknown formats", async () => {
  const png = await fixture("alpha.png");
  const huge = png.slice();
  new DataView(huge.buffer).setUint32(16, 16385);
  expect(() => validateImageBytes(huge)).toThrow("supported size");
  const pixels = png.slice();
  const view = new DataView(pixels.buffer);
  view.setUint32(16, 6000);
  view.setUint32(20, 4001);
  expect(() => validateImageBytes(pixels)).toThrow("24 megapixels");
  const chunk = new Uint8Array(12);
  chunk.set(new TextEncoder().encode("acTL"), 4);
  const animated = new Uint8Array(png.length + 12);
  animated.set(png.subarray(0, 33));
  animated.set(chunk, 33);
  animated.set(png.subarray(33), 45);
  expect(() => validateImageBytes(animated)).toThrow("Animated");
  const malformed = png.slice();
  new DataView(malformed.buffer).setUint32(33, 0xffffffff);
  expect(() => validateImageBytes(malformed)).toThrow();
  for (const raw of ["<svg/>", "GIF89a", "not an image"])
    expect(() => validateImageBytes(new TextEncoder().encode(raw))).toThrow();
  expect(() =>
    validateImageBytes(new Uint8Array(MAX_IMAGE_BYTES + 1)),
  ).toThrow();
});
test("local-image-validation rejects animated WebP and malformed RIFF size", async () => {
  const bytes = await fixture("still.webp");
  const bad = bytes.slice();
  new DataView(bad.buffer).setUint32(4, 0xffffffff, true);
  expect(() => validateImageBytes(bad)).toThrow();
  const header = new Uint8Array(30);
  header.set(new TextEncoder().encode("RIFF"));
  header.set(new TextEncoder().encode("WEBPVP8X"), 8);
  const view = new DataView(header.buffer);
  view.setUint32(4, 22, true);
  view.setUint32(16, 10, true);
  header[20] = 2;
  expect(() => validateImageBytes(header)).toThrow("Animated");
});
