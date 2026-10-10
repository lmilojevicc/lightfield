import { expect, test } from "bun:test";
import { createPresentationHandoff } from "../../../src/ui/shell/presentation-handoff";

function fixture(afterCommit?: Promise<void>) {
  let opacity = "1";
  let translate = "none";
  const styles = new Map<string, string>();
  let moving = false;
  const animations: {
    cancel: () => void;
    onfinish: (() => void) | undefined;
    cancelled: boolean;
  }[] = [];
  const frames: Keyframe[][] = [];
  const commits: string[] = [];
  const original = globalThis.getComputedStyle;
  globalThis.getComputedStyle = (() => ({
    opacity,
    translate,
    getPropertyValue: () => "cubic-bezier(.22,1,.36,1)",
  })) as unknown as typeof getComputedStyle;
  const panel = {
    style: {
      set opacity(value: string) {
        styles.set("opacity", value);
      },
      set translate(value: string) {
        styles.set("translate", value);
      },
      removeProperty: (key: string) => styles.delete(key),
    },
    hasAttribute: () => moving,
    setAttribute: () => {
      moving = true;
    },
    removeAttribute: () => {
      moving = false;
    },
    animate(next: Keyframe[]) {
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
  const motion = createPresentationHandoff(panel, (mode) => {
    expect(styles.get("opacity") ?? "0").toBe("0");
    commits.push(mode);
    return afterCommit;
  });
  return {
    motion,
    animations,
    frames,
    commits,
    styles,
    moving: () => moving,
    sample: (o: string, t: string) => {
      opacity = o;
      translate = t;
    },
    restore: () => {
      globalThis.getComputedStyle = original;
    },
  };
}

test("presentation handoff commits only when hidden, with opacity/translate-only frames and cleanup", () => {
  const f = fixture();
  try {
    f.motion.request("drawer", false);
    expect(f.commits).toEqual([]);
    f.animations[0]?.onfinish?.();
    expect(f.commits).toEqual(["drawer"]);
    expect(f.frames[1]).toEqual([
      { opacity: 0, translate: "8px" },
      { opacity: 1, translate: "0px" },
    ]);
    f.animations[1]?.onfinish?.();
    expect(f.styles.size).toBe(0);
    expect(f.moving()).toBe(false);
  } finally {
    f.restore();
  }
});

test("presentation handoff retargets rendered values before cancellation and stale callbacks cannot commit", () => {
  const f = fixture();
  try {
    f.motion.request("drawer", false);
    const stale = f.animations[0]?.onfinish;
    f.sample("0.4", "3px");
    f.motion.request("modal", false);
    stale?.();
    expect(f.commits).toEqual([]);
    expect(f.frames[1]?.[0]).toEqual({ opacity: "0.4", translate: "3px" });
    f.animations[1]?.onfinish?.();
    expect(f.commits).toEqual(["modal"]);
    const arrival = f.animations[2]?.onfinish;
    f.motion.destroy();
    arrival?.();
    expect(f.styles.size).toBe(0);
    expect(f.moving()).toBe(false);
  } finally {
    f.restore();
  }
});

test("instant/reduced/close settlement invalidates both phases and leaves no overrides", () => {
  const f = fixture();
  try {
    f.motion.request("drawer", false);
    const stale = f.animations[0]?.onfinish;
    f.motion.request("modal", true);
    stale?.();
    expect(f.commits).toEqual(["modal"]);
    expect(f.animations).toHaveLength(1);
    expect(f.styles.size).toBe(0);
    expect(f.moving()).toBe(false);
  } finally {
    f.restore();
  }
});

test("presentation handoff stays hidden until parent effects settle; pending arrival is revision guarded", async () => {
  let finish!: () => void;
  const parentEffects = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const f = fixture(parentEffects);
  try {
    f.motion.request("drawer", false);
    f.animations[0]?.onfinish?.();
    expect(f.styles.get("opacity")).toBe("0");
    expect(f.animations).toHaveLength(1);
    finish();
    await parentEffects;
    expect(f.animations).toHaveLength(2);
    f.animations[1]?.onfinish?.();
    expect(f.styles.size).toBe(0);
  } finally {
    f.restore();
  }
});

test("settlement invalidates an arrival waiting for parent section effects", async () => {
  let finish!: () => void;
  const parentEffects = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const f = fixture(parentEffects);
  try {
    f.motion.request("drawer", false);
    f.animations[0]?.onfinish?.();
    f.motion.settle("modal");
    finish();
    await parentEffects;
    expect(f.animations).toHaveLength(1);
    expect(f.styles.size).toBe(0);
    expect(f.commits).toEqual(["drawer", "modal"]);
  } finally {
    f.restore();
  }
});
