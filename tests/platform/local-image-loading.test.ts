import { expectRejected } from "./rejection";
import { expect, test } from "bun:test";
import { prepareLocalImage } from "../../src/platform/images/local-image-loading";
import { displayDimensions } from "../../src/domain/images/local-image-geometry";

// Mock only the decoder/DOM boundary; real fixture headers and orientation policy
// still flow through prepareLocalImage. Installed-extension tests check real pixels.
for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8])
  test(`local-image-loading exact oriented derivative ${String(orientation)}, rejects transposed output`, async () => {
    const restore: (() => void)[] = [];
    const set = (key: string, value: unknown) => {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
      Object.defineProperty(globalThis, key, {
        configurable: true,
        value,
        writable: true,
      });
      restore.push(() => {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      });
    };
    const size = displayDimensions(
      orientation >= 5 ? 200 : 320,
      orientation >= 5 ? 320 : 200,
      160,
      900,
      1,
      "contain",
    );
    let transpose = false;
    class Image {
      naturalWidth = transpose ? size.height : size.width;
      naturalHeight = transpose ? size.width : size.height;
      decode() {
        return Promise.resolve();
      }
      remove() {}
      removeAttribute() {}
    }
    class Worker {
      onmessage?: (event: { data: { blob: Blob } }) => void;
      postMessage() {
        queueMicrotask(() =>
          this.onmessage?.({
            data: { blob: new Blob(["mock bounded decoder output"]) },
          }),
        );
      }
      terminate() {}
    }
    try {
      set("document", { hidden: false, baseURI: "https://fixture.invalid/" });
      set("innerWidth", 160);
      set("innerHeight", 900);
      set("devicePixelRatio", 1);
      set("Image", Image);
      set("Worker", Worker);
      set("OffscreenCanvas", function OffscreenCanvas() {});
      set("createImageBitmap", () => {});
      const blob = new Blob(
        [
          await Bun.file(
            new URL(
              `../fixtures/images/orientation-${String(orientation)}.jpg`,
              import.meta.url,
            ),
          ).arrayBuffer(),
        ],
        { type: "image/jpeg" },
      );
      const prepared = await prepareLocalImage(blob, "contain");
      expect([prepared.width, prepared.height]).toEqual([
        size.width,
        size.height,
      ]);
      prepared.dispose();
      transpose = true;
      await expectRejected(prepareLocalImage(blob, "contain"), "orientation");
    } finally {
      for (const reset of restore.reverse()) reset();
    }
  });
