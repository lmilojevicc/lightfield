import { expect, test } from "bun:test";
import {
  createFontSaveBarrier,
  fontSaveBlocksClose,
} from "../../../src/ui/fonts/font-save-barrier";

test("submitted font write may outlive ten-second close barrier; late timers cannot reopen it", async () => {
  const callbacks: (() => void)[] = [];
  let slow = false,
    cancelled = 0,
    resolve: (() => void) | undefined;
  const write = new Promise<void>((done) => {
    resolve = done;
  });
  const barrier = createFontSaveBarrier({
    schedule(callback, ms) {
      expect(ms).toBe(10000);
      callbacks.push(callback);
      return callbacks.length;
    },
    cancel() {
      cancelled++;
    },
    slow(value) {
      slow = value;
    },
  });
  barrier.begin();
  expect(slow).toBe(false);
  callbacks[0]?.();
  expect(slow).toBe(true);
  // Dismissal is only view ownership: it never resolves/cancels this submitted persistence.
  let persisted = false;
  const completion = write.then(() => {
    persisted = true;
    barrier.finish();
  });
  expect(persisted).toBe(false);
  resolve?.();
  await completion;
  expect(persisted).toBe(true);
  expect(slow).toBe(false);
  expect(cancelled).toBe(1);
  callbacks[0]?.();
  expect(slow).toBe(false);
  barrier.begin();
  barrier.finish();
  callbacks[1]?.();
  expect(slow).toBe(false);
});

test("only short custom-editor saves block Settings; presets never acquire the custom barrier", () => {
  expect(fontSaveBlocksClose("custom", false)).toBe(true);
  expect(fontSaveBlocksClose("custom", true)).toBe(false);
  expect(fontSaveBlocksClose("preset", false)).toBe(false);
  expect(fontSaveBlocksClose("preset", true)).toBe(false);
  expect(fontSaveBlocksClose(null, false)).toBe(false);
});
