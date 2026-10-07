import { requiredValue } from "../../src/effects/runtime/required-value";
import { expect, test } from "bun:test";
import {
  createLocalImage,
  preparedImageThumbnail,
} from "../../src/effects/local-image";
import type { PreparedLocalImage } from "../../src/platform/images/local-image-loading";
import type {
  LocalImageAssetId,
  LocalImageSettings,
} from "../../src/shared/local-image";
import type {
  BackgroundUpdateContext,
  ThemePalette,
} from "../../src/effects/runtime/contracts";

const palette: ThemePalette = {
  paper: [0, 0, 0],
  paperHex: "#000000",
  ink: [1, 1, 1],
  inkHex: "#ffffff",
  accent: [1, 0, 0],
  accentHex: "#ff0000",
  focus: [1, 0, 0],
  focusHex: "#ff0000",
  lightTheme: false,
};
const assetId = "01234567-89ab-4abc-89ab-0123456789ab" as LocalImageAssetId;
const settings: LocalImageSettings = {
  version: 1,
  assetId,
  fit: "cover",
  filter: "none",
  filterOverrides: {},
};

test("matching original candidate remains decoded and owned across warm inactivity, releases exactly once", async () => {
  let disposed = 0,
    appended = 0,
    hidden = false;
  const image = {
    className: "",
    style: { objectFit: "" },
    get hidden() {
      return hidden;
    },
    set hidden(next: boolean) {
      hidden = next;
    },
  };
  const host = {
    append(next: unknown) {
      expect(next).toBe(image);
      appended++;
    },
  } as unknown as HTMLElement;
  const prepared: PreparedLocalImage = {
    image: image as HTMLImageElement,
    metadata: {
      mime: "image/png",
      bytes: 128,
      width: 640,
      height: 360,
      orientation: 1,
    },
    width: 640,
    height: 360,
    dispose() {
      disposed++;
    },
  };
  const state: BackgroundUpdateContext = {
    config: {},
    palette,
    visible: true,
    reducedMotion: false,
  };
  const previousDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { hidden: false },
  });
  try {
    const abort = new AbortController();
    const instance = await createLocalImage(
      {
        assets: {
          get() {
            return Promise.resolve(undefined);
          },
        },
        prepare() {
          return Promise.reject(new Error("unexpected preparation"));
        },
      },
      host,
      settings,
      abort.signal,
      prepared,
      state,
    );
    expect(disposed).toBe(0);
    expect(appended).toBe(1);
    instance.update({ ...state, visible: false });
    expect(hidden).toBe(true);
    expect(disposed).toBe(0);
    instance.update(state);
    expect(hidden).toBe(false);
    expect(disposed).toBe(0);
    expect(appended).toBe(1);
    expect(
      preparedImageThumbnail(host, "other" as LocalImageAssetId),
    ).toBeUndefined();
    instance.destroy();
    instance.destroy();
    expect(disposed).toBe(1);
    expect(preparedImageThumbnail(host, assetId)).toBeUndefined();
  } finally {
    if (previousDocument)
      Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("injected read-only preparation completing after cancellation releases its derivative without attachment", async () => {
  let disposed = 0,
    attached = 0,
    reads = 0;
  let complete: ((image: PreparedLocalImage) => void) | undefined;
  const prepared: PreparedLocalImage = {
    image: { style: {} } as HTMLImageElement,
    metadata: {
      mime: "image/png",
      bytes: 128,
      width: 640,
      height: 360,
      orientation: 1,
    },
    width: 640,
    height: 360,
    dispose() {
      disposed++;
    },
  };
  const previousDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { hidden: false },
  });
  try {
    const abort = new AbortController();
    const pending = createLocalImage(
      {
        assets: {
          get(id) {
            reads++;
            expect(id).toBe(assetId);
            return Promise.resolve({
              id: assetId,
              original: new Blob(["original"]),
              ...prepared.metadata,
              createdAt: 1,
              formatVersion: 1,
            });
          },
        },
        prepare(blob, fit, signal) {
          expect(blob.size).toBeGreaterThan(0);
          expect(fit).toBe("cover");
          expect(signal).toBe(abort.signal);
          return new Promise((resolve) => {
            complete = resolve;
          });
        },
      },
      {
        append() {
          attached++;
        },
      } as unknown as HTMLElement,
      settings,
      abort.signal,
    );
    // Attach rejection ownership before cancelling, just like a renderer generation.
    const result = pending.then(
      () => false,
      (error: unknown) => error instanceof Error,
    );
    await Promise.resolve();
    abort.abort();
    requiredValue(complete)(prepared);
    expect(await result).toBe(true);
    expect(reads).toBe(1);
    expect(disposed).toBe(1);
    expect(attached).toBe(0);
  } finally {
    if (previousDocument)
      Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("active thumbnail borrowing uses only bounded adopted pixels and ends with image ownership", async () => {
  let disposed = 0,
    draws = 0;
  const tiny = new Blob(["tiny"], { type: "image/png" });
  const image = { style: {} } as HTMLImageElement;
  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return {
        drawImage(source: unknown) {
          expect(source).toBe(image);
          draws++;
        },
      };
    },
    toBlob(callback: BlobCallback) {
      expect(canvas.width).toBeLessThanOrEqual(144);
      expect(canvas.height).toBeLessThanOrEqual(96);
      callback(tiny);
    },
  };
  const host = { append() {} } as unknown as HTMLElement;
  const prepared: PreparedLocalImage = {
    image,
    metadata: {
      mime: "image/png",
      bytes: 128,
      width: 640,
      height: 360,
      orientation: 1,
    },
    width: 640,
    height: 360,
    dispose() {
      disposed++;
    },
  };
  const previousDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { hidden: false, createElement: () => canvas },
  });
  try {
    const instance = await createLocalImage(
      {
        assets: {
          get() {
            return Promise.reject(
              new Error("Borrower must not read originals"),
            );
          },
        },
        prepare() {
          return Promise.reject(
            new Error("Borrower must not compete with preparation"),
          );
        },
      },
      host,
      settings,
      new AbortController().signal,
      prepared,
    );
    expect(await preparedImageThumbnail(host, assetId)).toBe(tiny);
    expect(draws).toBe(1);
    expect(disposed).toBe(0);
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    instance.destroy();
    expect(preparedImageThumbnail(host, assetId)).toBeUndefined();
    expect(disposed).toBe(1);
  } finally {
    if (previousDocument)
      Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
