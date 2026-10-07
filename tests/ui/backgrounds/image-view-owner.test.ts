import { test, expect } from "bun:test";
import type {
  AppServices,
  ImageSessionIntent,
} from "../../../src/services/contracts";
import type { PreparedLocalImage } from "../../../src/platform/images/local-image-loading";
import { ImageViewOwner } from "../../../src/ui/backgrounds/image-view-owner";

const intent: ImageSessionIntent = {
  epoch: 1,
  revision: 2,
  assetId: null,
  background: "ink",
};
function fixture() {
  const completions: (() => void)[] = [];
  let resolve!: (value: PreparedLocalImage) => void;
  let reject!: (error: Error) => void;
  let disposed = 0;
  let captured: ImageSessionIntent | null = null;
  let signal: AbortSignal | null = null;
  const prepared = {
    dispose: () => disposed++,
  } as unknown as PreparedLocalImage;
  const services = {
    images: {
      import: (
        _: Blob,
        expected: ImageSessionIntent,
        fit: string,
        incoming: AbortSignal,
      ) => {
        expect(fit).toBe("cover");
        captured = expected;
        signal = incoming;
        return new Promise<PreparedLocalImage>((yes, no) => {
          resolve = yes;
          completions.push(() => {
            yes(prepared);
          });
          reject = no;
        });
      },
    },
  } as unknown as AppServices;
  return {
    owner: new ImageViewOwner(services),
    completions,
    prepared,
    resolve: () => {
      resolve(prepared);
    },
    reject: () => {
      reject(new Error("save failed"));
    },
    disposed: () => disposed,
    captured: () => captured,
    signal: () => signal,
  };
}
test("image dialog intent is passed unchanged; completed derivative is disposed once", async () => {
  const f = fixture();
  const work = f.owner.import(new Blob(["image"]), intent);
  expect(f.captured()).toBe(intent);
  f.resolve();
  await work;
  expect(f.disposed()).toBe(1);
  f.owner.cancel();
  expect(f.disposed()).toBe(1);
});
test("late completion after view cancellation cannot retain a decoded owner", async () => {
  const f = fixture();
  const work = f.owner.import(new Blob(["image"]), intent);
  f.owner.cancel();
  expect(f.signal()?.aborted).toBe(true);
  f.resolve();
  await work;
  expect(f.disposed()).toBe(1);
});
test("import rejection is surfaced, with no fabricated successful prepared image", async () => {
  const f = fixture();
  const work = f.owner.import(new Blob(["image"]), intent);
  f.reject();
  const reason = await work.catch((error: unknown) => error);
  expect(reason).toBeInstanceOf(Error);
  expect((reason as Error).message).toBe("save failed");
  expect(f.disposed()).toBe(0);
});
test("new operation cancels the prior owner and releases both late derivatives", async () => {
  const f = fixture();
  const first = f.owner.import(new Blob(["one"]), intent);
  const firstSignal = f.signal();
  expect(firstSignal?.aborted).toBe(false);
  const second = f.owner.import(new Blob(["two"]), intent);
  expect(firstSignal?.aborted).toBe(true);
  expect(f.signal()?.aborted).toBe(false);
  f.completions[0]?.();
  f.completions[1]?.();
  await Promise.all([first, second]);
  expect(f.disposed()).toBe(2);
});
