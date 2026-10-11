import { expect, test } from "bun:test";
import {
  createPresentationHandoff,
  presentationFlip,
} from "../../../src/ui/shell/presentation-handoff";

const box = (left = 240, top = 150, width = 800, height = 600) => ({
  left,
  top,
  width,
  height,
});
function fixture(afterCommit?: Promise<void>) {
  let rendered = box();
  let opacity = "1";
  let contentOpacity = "1";
  const styles: Record<string, string> = {};
  const store = (target: Record<string, string>) =>
    new Proxy(target, {
      get: (values, key: string) =>
        key === "removeProperty"
          ? (name: string) => {
              Reflect.deleteProperty(
                values,
                name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()),
              );
            }
          : values[key],
    });
  const childStores: Record<string, string>[] = [{}, {}, {}];
  const attrs = new Set<string>();
  const animations: {
    onfinish: (() => void) | undefined;
    cancel: () => void;
  }[] = [];
  const frames: Keyframe[][] = [];
  const timings: KeyframeAnimationOptions[] = [];
  const commits: string[] = [];
  const commitOpacity: (string | undefined)[] = [];
  const original = globalThis.getComputedStyle;
  globalThis.getComputedStyle = ((target?: { __child?: boolean }) => ({
    opacity: target?.__child ? contentOpacity : opacity,
    transform: "matrix(1, 0, 0, 1, -400, -300)",
    transformOrigin: "400px 300px",
    getPropertyValue: () => "",
  })) as unknown as typeof getComputedStyle;
  const animate = (next: Keyframe[], options: KeyframeAnimationOptions) => {
    frames.push(next);
    timings.push(options);
    const animation = {
      onfinish: undefined as (() => void) | undefined,
      cancel() {},
    };
    animations.push(animation);
    return animation;
  };
  const panel = {
    style: store(styles),
    children: childStores.map((values) => ({
      __child: true,
      style: store(values),
      animate,
    })),
    animate,
    getBoundingClientRect: () =>
      styles.transform === "none" ? box(840, 0, 440, 900) : rendered,
    hasAttribute: (key: string) => attrs.has(key),
    setAttribute: (key: string) => attrs.add(key),
    removeAttribute: (key: string) => attrs.delete(key),
  } as unknown as HTMLElement;
  const motion = createPresentationHandoff(panel, (mode) => {
    commits.push(mode);
    commitOpacity.push(styles.opacity);
    return afterCommit;
  });
  return {
    motion,
    animations,
    frames,
    timings,
    commits,
    commitOpacity,
    styles,
    attrs,
    childStores,
    sample: (o: string, r = box()) => {
      opacity = o;
      rendered = r;
    },
    setContent: (value: string) => {
      contentOpacity = value;
    },
    restore: () => {
      globalThis.getComputedStyle = original;
    },
  };
}

test("FLIP uses natural target coordinates and independent scale axes", () => {
  expect(presentationFlip(box(), box(840, 0, 440, 900))).toBe(
    "translate(-600px, 150px) scale(1.8181818181818181, 0.6666666666666666)",
  );
  expect(presentationFlip(box(840, 0, 440, 900), box(640, 450))).toBe(
    "translate(200px, -450px) scale(0.55, 1.5)",
  );
});

test("one hidden commit, transform-only morph, delayed content and complete cleanup", () => {
  const f = fixture();
  try {
    f.motion.request("drawer", false);
    expect(f.commits).toEqual([]);
    expect(f.timings[0]?.duration).toBe(90);
    f.animations[0]?.onfinish?.();
    expect(f.styles.opacity).toBe("0");
    expect(f.commits).toEqual(["drawer"]);
    expect(f.commitOpacity).toEqual(["0"]);
    expect(f.attrs.has("data-presentation-morph")).toBe(true);
    expect(f.frames[1]).toEqual([
      {
        transform:
          "translate(-600px, 150px) scale(1.8181818181818181, 0.6666666666666666)",
      },
      { transform: "translate(0px, 0px) scale(1, 1)" },
    ]);
    expect(f.timings[1]?.duration).toBe(160);
    expect(f.timings[2]?.duration).toBe(130);
    expect(f.timings[3]?.delay).toBe(96);
    expect(f.timings[3]?.duration).toBe(120);
    f.animations[1]?.onfinish?.();
    expect(f.styles.transform).toBeUndefined();
    for (const a of f.animations.slice(3)) a.onfinish?.();
    expect(f.styles).toEqual({});
    expect(f.attrs.size).toBe(0);
  } finally {
    f.restore();
  }
});

test("reversal freezes sampled geometry and invalidates stale callbacks", () => {
  const f = fixture();
  try {
    f.motion.request("drawer", false);
    f.animations[0]?.onfinish?.();
    const stale = f.animations[5]?.onfinish;
    f.sample("0.4", box(600, 50, 600, 800));
    f.motion.request("modal", false);
    expect(f.attrs.has("data-presentation-morph")).toBe(true);
    stale?.();
    expect(f.timings[6]?.duration).toBe(36);
    f.animations[6]?.onfinish?.();
    expect(f.frames[7]?.[0]).toEqual({
      transform:
        "translate(-240px, 50px) scale(1.3636363636363635, 0.8888888888888888)",
    });
    f.motion.destroy();
    expect(f.styles).toEqual({});
    expect(f.attrs.size).toBe(0);
  } finally {
    f.restore();
  }
});

test("reversal during the content fade freezes rendered child opacity", () => {
  const f = fixture();
  try {
    f.motion.request("drawer", false);
    f.animations[0]?.onfinish?.();
    f.setContent("0.55");
    f.motion.request("modal", false);
    expect(f.childStores).toEqual([
      { opacity: "0.55" },
      { opacity: "0.55" },
      { opacity: "0.55" },
    ]);
    f.motion.destroy();
    expect(f.styles).toEqual({});
    expect(f.childStores).toEqual([{}, {}, {}]);
    expect(f.attrs.size).toBe(0);
  } finally {
    f.restore();
  }
});

test("pre-commit reversal invalidates the outgoing callback", () => {
  const f = fixture();
  try {
    f.motion.request("drawer", false);
    const stale = f.animations[0]?.onfinish;
    f.sample("0.7");
    f.motion.request("modal", false);
    stale?.();
    expect(f.commits).toEqual([]);
    f.animations[1]?.onfinish?.();
    expect(f.commits).toEqual(["modal"]);
    expect(f.commitOpacity).toEqual(["0"]);
    f.motion.destroy();
    expect(f.styles).toEqual({});
    expect(f.attrs.size).toBe(0);
  } finally {
    f.restore();
  }
});

test("instant reduced-motion/closed path and settle clear all overrides", () => {
  const f = fixture();
  try {
    f.motion.request("drawer", false);
    const stale = f.animations[0]?.onfinish;
    f.motion.request("modal", true);
    stale?.();
    expect(f.commits).toEqual(["modal"]);
    expect(f.animations).toHaveLength(1);
    expect(f.styles).toEqual({});
    expect(f.attrs.size).toBe(0);
  } finally {
    f.restore();
  }
});

test("arrival waits for the parent's tick before starting geometry or content", async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const f = fixture(pending);
  try {
    f.motion.request("drawer", false);
    f.animations[0]?.onfinish?.();
    expect(f.styles.opacity).toBe("0");
    expect(f.animations).toHaveLength(1);
    expect(f.attrs.has("data-presentation-morph")).toBe(true);
    finish();
    await pending;
    expect(f.animations).toHaveLength(6);
    f.motion.destroy();
    expect(f.styles).toEqual({});
    expect(f.attrs.size).toBe(0);
  } finally {
    f.restore();
  }
});

test("awaited parent tick remains invisible and settle invalidates pending entry", async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const f = fixture(pending);
  try {
    f.motion.request("drawer", false);
    f.animations[0]?.onfinish?.();
    expect(f.styles.opacity).toBe("0");
    expect(f.animations).toHaveLength(1);
    f.motion.settle("modal");
    finish();
    await pending;
    expect(f.animations).toHaveLength(1);
    expect(f.styles).toEqual({});
    expect(f.attrs.size).toBe(0);
  } finally {
    f.restore();
  }
});
