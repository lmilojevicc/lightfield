import { expect, test } from "bun:test";
import { createPresentationMotion } from "../../../src/ui/shell/presentation-motion";

function fixture() {
  let reduced = false;
  let moving = false;
  const animations: {
    cancelled: boolean;
    onfinish: (() => void) | undefined;
  }[] = [];
  const frames: Keyframe[][] = [];
  let rect = { left: 100, top: 100, width: 740, height: 540 };
  const panel = {
    getBoundingClientRect: () => ({ ...rect }),
    setAttribute: () => {
      moving = true;
    },
    removeAttribute: () => {
      moving = false;
    },
    animate(next: Keyframe[], options: KeyframeAnimationOptions) {
      expect(options.duration).toBe(180);
      frames.push(next);
      const animation = {
        cancelled: false,
        onfinish: undefined as (() => void) | undefined,
        cancel() {
          this.cancelled = true;
        },
      };
      animations.push(animation);
      return animation;
    },
  } as unknown as HTMLElement;
  return {
    motion: createPresentationMotion(panel, () => reduced),
    animations,
    frames,
    moving: () => moving,
    reduce: () => {
      reduced = true;
    },
    drawer: () => {
      rect = { left: 840, top: 0, width: 440, height: 800 };
    },
  };
}

test("presentation motion interpolates real geometry without scaling text", () => {
  const f = fixture();
  const from = f.motion.capture();
  f.drawer();
  f.motion.play(from);
  expect(f.frames[0]?.map((frame) => frame.transform)).toEqual([
    "none",
    "none",
  ]);
  expect(f.frames[0]?.map((frame) => frame.width)).toEqual(["740px", "440px"]);
  f.animations[0]?.onfinish?.();
  expect(f.moving()).toBe(false);
  expect(f.animations[0]?.cancelled).toBe(true);
});
test("rapid retoggle cancels old motion and invalidates pending ticks; close/unmount cancel too", () => {
  const f = fixture();
  const old = f.motion.capture();
  f.motion.play(old);
  const next = f.motion.capture();
  expect(f.animations[0]?.cancelled).toBe(true);
  f.motion.play(old);
  expect(f.animations).toHaveLength(1);
  f.motion.play(next);
  f.motion.cancel();
  f.motion.play(next);
  expect(f.animations).toHaveLength(2);
  expect(f.animations[1]?.cancelled).toBe(true);
  expect(f.moving()).toBe(false);
});
test("reduced motion uses final layout immediately and cancels in-flight work", () => {
  const f = fixture();
  f.reduce();
  const from = f.motion.capture();
  f.motion.play(from);
  expect(f.animations).toHaveLength(0);
  expect(f.moving()).toBe(false);
});
