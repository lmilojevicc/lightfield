import { describe, expect, test } from "bun:test";
import { createBootReveal } from "../../../src/app/boot-reveal";

function fixture() {
  let timeout: (() => void) | undefined;
  let count = 0;
  let cancelled = 0;
  const boot = createBootReveal({
    reveal() {
      count++;
    },
    schedule(callback, ms) {
      expect(ms).toBe(900);
      timeout = callback;
      return 1;
    },
    cancel(timer) {
      expect(timer).toBe(1);
      cancelled++;
    },
  });
  return {
    boot,
    timeout: () => timeout?.(),
    count: () => count,
    cancelled: () => cancelled,
  };
}
describe("source boot reveal ownership", () => {
  test("paint alone waits for initialization, then reveals once", () => {
    const f = fixture();
    f.boot.painted();
    expect(f.count()).toBe(0);
    f.boot.initialized();
    f.boot.painted();
    f.timeout();
    expect(f.count()).toBe(1);
    expect(f.cancelled()).toBe(1);
  });
  test("initialization alone waits for actual paint", () => {
    const f = fixture();
    f.boot.initialized();
    expect(f.count()).toBe(0);
    f.boot.painted();
    expect(f.count()).toBe(1);
  });
  test("timeout and initialization rejection never leave a permanent mask", () => {
    const stalled = fixture();
    stalled.timeout();
    expect(stalled.count()).toBe(1);
    const failed = fixture();
    failed.boot.failed();
    failed.timeout();
    expect(failed.count()).toBe(1);
  });
  test("teardown blocks late paint, ready and timer callbacks", () => {
    const f = fixture();
    f.boot.dispose();
    f.boot.initialized();
    f.boot.painted();
    f.timeout();
    f.boot.failed();
    expect(f.count()).toBe(0);
    expect(f.cancelled()).toBe(1);
  });
});
