import { requiredValue } from "../../../src/effects/runtime/required-value";
import { test, expect } from "bun:test";
import { NeatGradient as LegacyNeatGradient } from "../../../src/vendor/neat/NeatGradient";
import { NeatGradient as CurrentNeatGradient } from "../../../src/vendor/neat/current/NeatGradient";
import { NEAT_PRESET_IDS } from "../../../src/shared/neat-preset-metadata";
import {
  neatBufferSize,
  neatPaletteColors,
  normalizeNeatConfig,
  NEAT_PIXEL_CAP,
} from "../../../src/shared/neat-metadata";
import {
  BACKGROUND_COLLECTIONS,
  NEAT_COLLECTION,
  REACT_BITS_COLLECTION,
  normalizeBackgroundOverrides,
} from "../../../src/shared/background-metadata";

test("Current NeatGradient colors setter invalidates procedural palette content, not identical stops or influence", () => {
  // Exercise the setter's dirty-state contract without allocating a WebGL context.
  const gradient = Object.create(CurrentNeatGradient.prototype) as {
    colors: { color: string; enabled: boolean; influence?: number }[];
    _uniformsDirty: boolean;
    _colorsChanged: boolean;
    _textureNeedsUpdate: boolean;
    _enableProceduralTexture: boolean;
  };
  Object.assign(gradient, {
    _colors: [{ color: "#112233", enabled: true }],
    _enableProceduralTexture: true,
  });
  const reset = () => {
    gradient._uniformsDirty =
      gradient._colorsChanged =
      gradient._textureNeedsUpdate =
        false;
  };
  reset();
  gradient.colors = [{ color: "#112233", enabled: true, influence: 1 }];
  expect(gradient._uniformsDirty).toBe(false);
  expect(gradient._colorsChanged).toBe(false);
  expect(gradient._textureNeedsUpdate).toBe(false);
  gradient.colors = [{ color: "#334455", enabled: true }];
  expect(gradient._colorsChanged).toBe(true);
  expect(gradient._textureNeedsUpdate).toBe(true);
  reset();
  gradient.colors = [{ color: "#334455", enabled: true, influence: 0.5 }];
  expect(gradient._colorsChanged).toBe(true);
  expect(gradient._textureNeedsUpdate).toBe(false);
  reset();
  gradient.colors = [{ color: "#334455", enabled: false, influence: 0.5 }];
  expect(gradient._textureNeedsUpdate).toBe(true);
  reset();
  gradient._enableProceduralTexture = false;
  gradient.colors = [{ color: "#556677", enabled: true }];
  expect(gradient._colorsChanged).toBe(true);
  expect(gradient._textureNeedsUpdate).toBe(false);
});

// Deterministic scheduling/resource probe, not a substitute for browser WebGL.
for (const NeatGradient of [LegacyNeatGradient, CurrentNeatGradient])
  test(`${NeatGradient === LegacyNeatGradient ? "Legacy" : "Current"} NeatGradient owns one RAF through 100 resizes; parks/resumes and releases all resources`, () => {
    const saved = new Map<string, PropertyDescriptor | undefined>();
    const install = (key: string, value: unknown) => {
      saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, value });
    };
    const frames = new Map<number, FrameRequestCallback>();
    const resources = new Set<object>();
    const listeners = new Set<string>();
    const times: number[] = [];
    let id = 0,
      now = 0,
      draws = 0,
      lost = 0,
      meta = 0,
      compile = true;
    const gl = new Proxy<Record<string, unknown>>(
      {},
      {
        get(target, key: string) {
          if (key in target) return target[key];
          if (/^[A-Z_0-9]+$/.test(key))
            return (target[key] = Object.keys(target).length + 1);
          return (target[key] = (...args: unknown[]) => {
            if (key === "drawElements") draws++;
            if (key === "uniform1f" && args[0] === "u_time")
              times.push(Number(args[1]));
            if (key === "getShaderParameter" || key === "getProgramParameter")
              return compile;
            if (key === "getAttribLocation") return 0;
            if (key === "getUniformLocation") return args[1];
            if (key === "getExtension")
              return {
                loseContext() {
                  lost++;
                },
              };
            if (key.startsWith("create")) {
              const resource = {};
              resources.add(resource);
              return resource;
            }
            if (key.startsWith("delete")) {
              expect(resources.delete(args[0] as object)).toBe(true);
            }
          });
        },
      },
    );
    const ctx = new Proxy(
      {},
      {
        get: (_, key) =>
          key === "measureText" ? () => ({ width: 35 }) : () => {},
      },
    );
    const canvas = {
      width: 800,
      height: 600,
      style: {},
      getContext: (kind: string) => (kind === "2d" ? ctx : gl),
      addEventListener: (type: string) => listeners.add(type),
      removeEventListener: (type: string) => listeners.delete(type),
    } as unknown as HTMLCanvasElement;
    install("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.set(++id, cb);
      return id;
    });
    install("cancelAnimationFrame", (id: number) => frames.delete(id));
    install("performance", { now: () => now });
    install("document", {
      querySelector: () => null,
      createElement: (tag: string) =>
        tag === "canvas"
          ? canvas
          : {
              remove() {
                meta--;
              },
            },
      head: {
        appendChild() {
          meta++;
        },
      },
    });
    try {
      const config = {
        ref: canvas,
        colors: [{ color: "#777777", enabled: true }],
        resolution: 0.25,
        speed: 2.5,
        seed: 6,
      };
      const gradient = new NeatGradient(config);
      const tick = (delta: number) => {
        now += delta;
        const current = [...frames.values()];
        frames.clear();
        current.forEach((cb) => {
          cb(now);
        });
      };
      expect(frames.size).toBe(1);
      for (let i = 0; i < 100; i++) {
        gradient.resize(800 + i, 600);
        expect(frames.size).toBe(1);
      }
      tick(1000);
      expect(times.at(-1)).toBe(6.125);
      gradient.pause();
      expect(frames.size).toBe(0);
      const before = draws;
      tick(10_000);
      expect(draws).toBe(before);
      gradient.resume();
      tick(1000);
      expect(times.at(-1)).toBe(6.25);
      gradient.setHostState(true, true);
      expect(frames.size).toBe(0);
      gradient.waveAmplitude = 8;
      gradient.render();
      expect(frames.size).toBe(0);
      gradient.resize(900, 700);
      expect(frames.size).toBe(0);
      expect(times.at(-1)).toBe(6.25);
      gradient.setHostState(false, false);
      gradient.render();
      expect(frames.size).toBe(0);
      gradient.setHostState(true, false);
      expect(frames.size).toBe(1);
      gradient.speed = 0;
      gradient.render();
      expect(frames.size).toBe(0);
      tick(10_000);
      gradient.speed = 2.5;
      gradient.render();
      expect(frames.size).toBe(1);
      tick(1000);
      expect(times.at(-1)).toBe(6.375);
      const orphan = requiredValue([...frames.values()][0]);
      gradient.destroy();
      gradient.destroy();
      orphan(now);
      expect(frames.size).toBe(0);
      expect(resources.size).toBe(0);
      expect(listeners.size).toBe(0);
      expect(meta).toBe(0);
      expect(lost).toBe(1);
      compile = false;
      expect(() => new NeatGradient(config)).toThrow();
      expect(resources.size).toBe(0);
      expect(listeners.size).toBe(0);
      expect(meta).toBe(0);
      expect(frames.size).toBe(0);
    } finally {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  });

test("neat-gradient has one attributed collection and bounded native controls/pixel density", () => {
  expect(NEAT_COLLECTION.ids).toEqual(["neat-gradient", ...NEAT_PRESET_IDS]);
  expect(REACT_BITS_COLLECTION.ids.includes("neat-gradient")).toBe(false);
  expect(
    BACKGROUND_COLLECTIONS.flatMap((c) => c.ids).filter(
      (id) => id === "neat-gradient",
    ),
  ).toHaveLength(1);
  expect(
    normalizeNeatConfig({ speed: Infinity, resolution: 3, colorBlending: 0 }),
  ).toMatchObject({ speed: 2.5, resolution: 1, colorBlending: 0.1 });
  expect(
    normalizeBackgroundOverrides({
      "neat-gradient": { speed: -1, resolution: 4, unknown: 5 },
    }),
  ).toEqual({ "neat-gradient": { speed: 0, resolution: 1 } });
  for (const width of [320, 390, 834, 1440, 3840])
    for (const dpr of [1, 2]) {
      const [w, h] = neatBufferSize(width, 2160, dpr);
      expect(w * h).toBeLessThanOrEqual(NEAT_PIXEL_CAP);
      expect(w).toBeLessThanOrEqual(width);
    }
  const colors = neatPaletteColors({
    paper: [0.1, 0.1, 0.1],
    ink: [0.9, 0.9, 0.9],
    accent: [0.5, 0.5, 0.5],
    focus: [0.7, 0.7, 0.7],
    paperHex: "#191919",
    inkHex: "#eeeeee",
    accentHex: "#888888",
    focusHex: "#bbbbbb",
    lightTheme: false,
  });
  expect(colors).toHaveLength(6);
  expect(
    colors.every(
      ({ color }) =>
        color.slice(1, 3) === color.slice(3, 5) &&
        color.slice(3, 5) === color.slice(5, 7),
    ),
  ).toBe(true);
});
