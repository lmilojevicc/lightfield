import { expectRejected } from "./rejection";
import { requiredValue } from "../../src/domain/required-value";
import { test, expect } from "bun:test";
import { imageTransaction } from "../../src/platform/images/local-image-store";
/** Minimal event seam models request success followed by transaction abort. Real IDB is also exercised in extension QA. */
test("local-image-store waits for IDB transaction complete, rejects abort after request success", async () => {
  const previous = globalThis.indexedDB;
  let transaction:
    | {
        oncomplete?: () => void;
        onabort?: () => void;
        onerror?: () => void;
        objectStore(): unknown;
        abort(): void;
        error: null;
      }
    | undefined;
  let closed = 0;
  const fake = {
    open() {
      const request: { result: unknown; onsuccess?: () => void } = {
        result: {
          close() {
            closed++;
          },
          transaction() {
            transaction = {
              error: null,
              objectStore: () => ({}),
              abort() {
                this.onabort?.();
              },
            };
            return transaction;
          },
        },
      };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  };
  Object.defineProperty(globalThis, "indexedDB", {
    value: fake,
    configurable: true,
  });
  try {
    let settled = false;
    const success = imageTransaction(
      "readwrite",
      (_, result) => {
        result("request succeeded");
      },
      globalThis.indexedDB,
    );
    void success.then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    requiredValue(transaction).oncomplete?.();
    expect(await success).toBe("request succeeded");
    const aborted = imageTransaction(
      "readwrite",
      (_, result) => {
        result("request succeeded");
      },
      globalThis.indexedDB,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    requiredValue(transaction).onabort?.();
    await expectRejected(aborted, "aborted transaction");
    expect(closed).toBe(2);
  } finally {
    Object.defineProperty(globalThis, "indexedDB", {
      value: previous,
      configurable: true,
    });
  }
});
