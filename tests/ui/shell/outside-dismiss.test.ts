import { expect, test } from "bun:test";
import { listenOutsideDismiss } from "../../../src/ui/shell/outside-dismiss";

function fixture() {
  const host = new EventTarget();
  const panel = {} as HTMLElement;
  let open = true;
  let blocked = false;
  let closes = 0;
  const listener = listenOutsideDismiss(
    host as Window,
    () => (open ? panel : null),
    () => {
      if (!blocked) {
        open = false;
        listener.reset();
        closes++;
      }
    },
  );
  function event(
    type: string,
    inside: boolean,
    { button = 0, pointerId = 1, isPrimary = true, detail = 1 } = {},
  ) {
    const event = new Event(type);
    Object.defineProperties(event, {
      button: { value: button },
      pointerId: { value: pointerId },
      isPrimary: { value: isPrimary },
      detail: { value: detail },
      composedPath: { value: () => (inside ? [panel, host] : [host]) },
    });
    host.dispatchEvent(event);
  }
  function gesture(startInside: boolean, endInside: boolean) {
    event("pointerdown", startInside);
    event("pointerup", endInside);
    // Opposite endpoints produce a click on their common ancestor, not the release target.
    event("click", startInside && endInside);
  }
  return {
    event,
    gesture,
    stop() {
      listener.destroy();
    },
    setOpen(value: boolean) {
      open = value;
      if (!open) listener.reset();
    },
    block: (value: boolean) => {
      blocked = value;
    },
    closes: () => closes,
  };
}

test("common-ancestor click targeting cannot turn outside-to-inside or inside-to-outside into dismissal", () => {
  const f = fixture();
  f.gesture(true, true); // includes footer/actions
  f.gesture(false, true); // pointerup inside; native click ancestor outside
  f.gesture(true, false); // includes slider-origin drags
  expect(f.closes()).toBe(0);
  f.event("pointerdown", false);
  f.event("pointerup", false);
  expect(f.closes()).toBe(0); // dismissal stays at click stage, preventing click-through
  f.event("click", false);
  expect(f.closes()).toBe(1);
  f.stop();
});

test("guarded close can reject, then permit; completion consumes the gesture", () => {
  const f = fixture();
  f.block(true);
  f.gesture(false, false);
  expect(f.closes()).toBe(0);
  f.block(false);
  f.event("click", false); // cannot reuse the blocked gesture
  expect(f.closes()).toBe(0);
  f.gesture(false, false);
  expect(f.closes()).toBe(1);
  f.setOpen(true);
  f.event("click", false);
  expect(f.closes()).toBe(1);
  f.stop();
  f.gesture(false, false);
  expect(f.closes()).toBe(1);
});

test("cancellation, disabling/reopening and incomplete gestures clear pending dismissal", () => {
  const f = fixture();
  f.event("pointerdown", false);
  f.event("pointercancel", false);
  f.event("pointerup", false);
  f.event("click", false);
  f.event("pointerdown", false);
  f.event("click", false); // no release
  f.event("pointerdown", false);
  f.event("pointerup", false);
  f.setOpen(false);
  f.setOpen(true);
  f.event("click", false);
  expect(f.closes()).toBe(0);
  f.stop();
});

test("wrong pointer, secondary buttons, nonprimary pointers and keyboard clicks cannot activate dismissal", () => {
  const f = fixture();
  for (const mismatch of [
    { pointerId: 2 },
    { button: 2 },
    { isPrimary: false },
  ]) {
    f.event("pointerdown", false);
    f.event("pointerup", false, mismatch);
    f.event("click", false);
  }
  for (const mismatch of [{ pointerId: 2 }, { button: 2 }, { detail: 0 }]) {
    f.event("pointerdown", false);
    f.event("pointerup", false);
    f.event("click", false, mismatch);
    f.event("click", false); // failed matching also consumes state
  }
  f.event("pointerdown", false, { button: 2 });
  f.event("pointerup", false);
  f.event("click", false);
  f.event("pointerdown", false, { isPrimary: false });
  f.event("pointerup", false);
  f.event("click", false);
  expect(f.closes()).toBe(0);
  f.stop();
});

test("a release without its immediate click expires instead of arming a later activation", async () => {
  const f = fixture();
  f.event("pointerdown", false);
  f.event("pointerup", false);
  await new Promise<void>((done) => setTimeout(done, 5));
  f.event("click", false);
  expect(f.closes()).toBe(0);
  f.stop();
});
