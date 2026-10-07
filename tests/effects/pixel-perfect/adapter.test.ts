import { afterEach, describe, expect, test } from "bun:test";
import {
  pixelPerfectFactory,
  type PixelPerfectRenderer,
} from "../../../src/effects/pixel-perfect/adapter";
import {
  normalizePixelPerfectConfig,
  PIXEL_PERFECT_IDS,
  PIXEL_PERFECT_DEFINITIONS,
  type PixelPerfectId,
} from "../../../src/shared/pixel-perfect-metadata";
import type {
  BackgroundContext,
  BackgroundInstance,
  BackgroundUpdateContext,
} from "../../../src/effects/runtime/contracts";
import {
  resolvePixelPerfectColors,
  type PixelPerfectColors,
} from "../../../src/effects/pixel-perfect/colors";
import { easedValue } from "../../../src/effects/pixel-perfect/dither-wave";

const originals = new Map<string, PropertyDescriptor | undefined>();
const replace = (key: string, value: unknown) => {
  if (!originals.has(key))
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value,
  });
};
afterEach(() => {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
});

function fixture() {
  const pending = new Map<number, FrameRequestCallback>();
  let serial = 0,
    removed = 0,
    disposed = 0,
    reported = 0,
    failDraw = false;
  const draws: number[] = [],
    failures: unknown[] = [];
  const windowListeners = new Set<string>();
  const canvas = Object.assign(new EventTarget(), {
    style: { cssText: "", background: "" },
    setAttribute() {},
    remove() {
      removed++;
    },
  });
  replace("document", { createElement: () => canvas });
  replace("window", {
    devicePixelRatio: 3,
    addEventListener(type: string) {
      windowListeners.add(type);
    },
    removeEventListener(type: string) {
      windowListeners.delete(type);
    },
  });
  replace("requestAnimationFrame", (callback: FrameRequestCallback) => {
    pending.set(++serial, callback);
    return serial;
  });
  replace("cancelAnimationFrame", (id: number) => pending.delete(id));
  const sizes: number[][] = [];
  const configured: PixelPerfectColors[] = [],
    mounted: PixelPerfectColors[] = [];
  const renderer: PixelPerfectRenderer = {
    draw(_w, _h, elapsed) {
      if (failDraw) throw new Error("draw failed");
      draws.push(elapsed);
    },
    resize(w, h, dpr) {
      sizes.push([w, h, dpr]);
    },
    configure(_config, colors) {
      configured.push(colors);
    },
    pointer() {},
    resetPointer() {},
    destroy() {
      disposed++;
    },
  };
  const context = {
    host: { append() {}, clientWidth: 660, clientHeight: 380 },
    config: {},
    palette: {
      paper: [0, 0, 0],
      paperHex: "#000000",
      ink: [1, 1, 1],
      inkHex: "#ffffff",
      accent: [1, 0, 0],
      accentHex: "#ff0000",
      focus: [0, 1, 0],
      focusHex: "#00ff00",
      lightTheme: false,
    },
    reducedMotion: false,
    visible: true,
    reportRuntimeFailure: (error: unknown) => failures.push(error),
    reportPaint: () => {
      reported++;
    },
  } as unknown as BackgroundContext;
  const create = (id: PixelPerfectId = PIXEL_PERFECT_IDS[0]) =>
    pixelPerfectFactory(id, (_canvas, _config, colors) => {
      mounted.push(colors);
      return renderer;
    })(context) as BackgroundInstance;
  return {
    configured,
    mounted,
    pending,
    draws,
    failures,
    sizes,
    windowListeners,
    canvas,
    context,
    create,
    counts: () => ({ removed, disposed }),
    reported: () => reported,
    fail: () => {
      failDraw = true;
    },
    tick() {
      const entries = [...pending.values()];
      pending.clear();
      entries.forEach((callback) => {
        callback(performance.now() + 16);
      });
    },
  };
}

describe("Pixel Perfect lifecycle", () => {
  test("pause, speed zero, hidden and reduced motion cancel RAF and pointer listeners; resume and destroy are bounded", () => {
    const f = fixture(),
      instance = f.create();
    expect(f.pending.size).toBe(1);
    expect(f.windowListeners.has("pointermove")).toBe(true);
    expect(f.sizes[0]).toEqual([660, 380, 2]);
    const changes: Partial<BackgroundUpdateContext>[] = [
      { visible: false },
      { reducedMotion: true },
      { config: { speed: 0 } },
      { config: { paused: true } },
    ];
    for (const change of changes) {
      instance.update({ ...f.context, ...change });
      expect(f.pending.size).toBe(0);
      expect(f.windowListeners.size).toBe(0);
      instance.update(f.context);
      expect(f.pending.size).toBe(1);
    }
    instance.update({ ...f.context, config: { interactive: false } });
    expect(f.windowListeners.size).toBe(0);
    expect(f.pending.size).toBe(1);
    instance.destroy();
    instance.destroy();
    instance.resize();
    instance.update(f.context);
    expect(f.pending.size).toBe(0);
    expect(f.counts()).toEqual({ removed: 1, disposed: 1 });
  });
  test("initial hidden/static modes schedule no RAF; Dither Field reduced frame follows source", () => {
    for (const change of [
      { visible: false },
      { reducedMotion: true },
      { config: { speed: 0 } },
    ]) {
      const f = fixture();
      Object.assign(f.context, change);
      const instance = f.create("pixel-perfect-dither-field");
      expect(f.pending.size).toBe(0);
      expect(f.draws[0]).toBe(
        f.context.visible ? (f.context.reducedMotion ? 2 : 0) : undefined,
      );
      if (!f.context.visible) {
        expect(f.sizes).toHaveLength(0);
        expect(f.reported()).toBe(0);
      } else expect(f.reported()).toBe(f.draws.length);
      instance.destroy();
    }
  });
  test("all six forward palette changes and repaint frozen frames without remount or RAF", () => {
    const modes: Partial<BackgroundUpdateContext>[] = [
      { config: { paused: true } },
      { config: { speed: 0 } },
      { visible: false },
      { reducedMotion: true },
    ];
    for (const id of PIXEL_PERFECT_IDS) {
      for (const mode of modes) {
        const f = fixture(),
          instance = f.create(id);
        f.tick();
        const frozen = { ...f.context, ...mode };
        instance.update(frozen);
        const elapsed = f.draws.at(-1),
          before = f.draws.length;
        const palette = {
          ...f.context.palette,
          paper: [1, 1, 1] as [number, number, number],
          paperHex: "#ffffff",
          ink: [0, 0, 0] as [number, number, number],
          inkHex: "#000000",
          accent: [0, 0, 1] as [number, number, number],
          accentHex: "#0000ff",
          lightTheme: true,
        };
        instance.update({ ...frozen, palette });
        if (frozen.visible)
          expect(f.configured.at(-1)).toEqual(
            resolvePixelPerfectColors(id, palette),
          );
        expect(f.canvas.style.background).toBe(palette.paperHex);
        expect(f.draws.length).toBe(before + (frozen.visible ? 1 : 0));
        expect(f.draws.at(-1)).toBe(elapsed);
        expect(f.pending.size).toBe(0);
        expect(f.mounted).toEqual([
          resolvePixelPerfectColors(id, f.context.palette),
        ]);
        expect(f.counts()).toEqual({ removed: 0, disposed: 0 });
        instance.update(frozen);
        if (frozen.visible) expect(f.configured.at(-1)).toEqual(f.mounted[0]);
        expect(f.draws.at(-1)).toBe(elapsed);
        expect(f.pending.size).toBe(0);
        if (!frozen.visible) {
          instance.update({ ...f.context, palette });
          expect(f.configured.at(-1)).toEqual(
            resolvePixelPerfectColors(id, palette),
          );
          expect(f.draws.length).toBe(before + 1);
        }
        instance.destroy();
      }
    }
  });
  test("runtime draw failure cleans and reports once", () => {
    const f = fixture(),
      instance = f.create();
    f.fail();
    f.tick();
    f.tick();
    instance.destroy();
    expect(f.failures).toHaveLength(1);
    expect(f.pending.size).toBe(0);
    expect(f.windowListeners.size).toBe(0);
    expect(f.counts()).toEqual({ removed: 1, disposed: 1 });
  });
  test("context loss disposes and reports once to existing retry controller", () => {
    const f = fixture(),
      instance = f.create();
    f.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    f.canvas.dispatchEvent(new Event("webglcontextlost"));
    instance.destroy();
    expect(f.failures.map(String)).toEqual([
      "Error: Pixel Perfect WebGL context lost",
    ]);
    expect(f.pending.size).toBe(0);
    expect(f.counts()).toEqual({ removed: 1, disposed: 1 });
  });
  test("startup failure removes its canvas", () => {
    const f = fixture();
    expect(() =>
      pixelPerfectFactory(PIXEL_PERFECT_IDS[0], () => {
        throw new Error("WebGL unavailable");
      })(f.context),
    ).toThrow("WebGL unavailable");
    expect(f.counts().removed).toBe(1);
    expect(f.pending.size).toBe(0);
  });
});

test("all six controls are bounded and defaults survive invalid input", () => {
  expect(PIXEL_PERFECT_IDS).toHaveLength(6);
  for (const id of PIXEL_PERFECT_IDS) {
    const definition = PIXEL_PERFECT_DEFINITIONS[id];
    expect(normalizePixelPerfectConfig(id, {})).toEqual(definition.defaults);
    expect(
      normalizePixelPerfectConfig(id, {
        speed: NaN,
        paused: "true",
        unexpected: 1,
      }),
    ).toEqual(definition.defaults);
    for (const control of definition.controls)
      if (control.type === "number") {
        expect(
          normalizePixelPerfectConfig(id, { [control.key]: -1e9 })[control.key],
        ).toBe(control.min);
        expect(
          normalizePixelPerfectConfig(id, { [control.key]: 1e9 })[control.key],
        ).toBe(control.max);
      }
  }
});
test("native pointer easing preserves upstream power3.out and power2.out curves", () => {
  expect(easedValue(0, 1, 0.5, 4)).toBe(0.9375);
  expect(easedValue(0, 1, 0.5, 3)).toBe(0.875);
  expect(easedValue(0, 1, 2, 4)).toBe(1);
});
