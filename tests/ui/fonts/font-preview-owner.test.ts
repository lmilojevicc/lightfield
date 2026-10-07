import { describe, expect, test } from "bun:test";
import { createFontPreviewOwner } from "../../../src/ui/fonts/font-preview-owner";
import { FONT_FAMILIES } from "../../../src/domain/fonts/font-pairings";
import type { FontPreview } from "../../../src/services/contracts";

function specimen() {
  let disposed = 0;
  const family = FONT_FAMILIES.find((font) => font.name === "Georgia");
  if (!family) throw new Error("Missing offline family");
  return {
    value: {
      display: family,
      body: family,
      dispose: () => {
        disposed++;
      },
    },
    disposed: () => disposed,
  };
}

describe("font specimen ownership", () => {
  test("superseded nonabortable preview is disposed without replacing newest aliases", async () => {
    const pending: Array<(value: FontPreview) => void> = [];
    const signals: AbortSignal[] = [];
    const owner = createFontPreviewOwner({
      preview: (_display, _body, signal) => {
        if (signal) signals.push(signal);
        return new Promise((resolve) => {
          pending.push(resolve);
        });
      },
    });
    const first = owner.load("Georgia", "Arial");
    const second = owner.load("Instrument Serif", "Arial");
    expect(signals[0]?.aborted).toBe(true);
    const old = specimen();
    const newest = specimen();
    pending[1]?.(newest.value);
    expect(await second).toBe(newest.value);
    pending[0]?.(old.value);
    expect(await first).toBeUndefined();
    expect(old.disposed()).toBe(1);
    expect(newest.disposed()).toBe(0);
    owner.clear();
    owner.clear();
    expect(newest.disposed()).toBe(1);
  });
  test("inactivity cancellation is quiet and a later retry works", async () => {
    let reject: (reason: Error) => void = () => {};
    const next = specimen();
    let calls = 0;
    const owner = createFontPreviewOwner({
      preview: () => {
        calls++;
        return calls === 1
          ? new Promise((_resolve, fail) => {
              reject = fail;
            })
          : Promise.resolve(next.value);
      },
    });
    const pending = owner.load("Georgia", "Arial");
    owner.clear();
    reject(new Error("cancelled"));
    expect(await pending).toBeUndefined();
    expect(await owner.load("Georgia", "Arial")).toBe(next.value);
    owner.clear();
  });
  test("genuine failure remains actionable, not swallowed as cancellation", async () => {
    const owner = createFontPreviewOwner({
      preview: () => Promise.reject(new Error("Unavailable")),
    });
    let failure: unknown;
    try {
      await owner.load("Georgia", "Arial");
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("Unavailable");
  });
});
