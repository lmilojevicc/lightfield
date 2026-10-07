import { expect, test } from "bun:test";
import { getBackgroundDescriptor } from "../../src/shared/background-metadata";
import {
  NEAT_DEFAULTS,
  NEAT_PARAMETERS,
  NEAT_PIXEL_CAP,
  NEAT_DPR_CAP,
  normalizeNeatConfig,
  neatBufferSize,
  neatPaletteColors,
} from "../../src/shared/neat-metadata";
import {
  NEAT_PRESET_IDS,
  NEAT_PRESET_DEFAULTS,
  NEAT_PRESET_PARAMETERS,
} from "../../src/shared/neat-preset-metadata";
import { ORBS_DEFAULT_SCALE_PCT } from "../../src/shared/orbs-metadata";
import type { ThemePalette } from "../../src/shared/theme";

test("legacy and current Neat metadata remain distinct and source precision is not slider-quantized", () => {
  const legacy = getBackgroundDescriptor("neat-gradient");
  expect(legacy.defaults).toEqual({
    opacity: 1,
    brightness: 1,
    saturation: 1,
    contrast: 1,
    ...NEAT_DEFAULTS,
  });
  expect(NEAT_PARAMETERS).toHaveLength(12);
  expect(NEAT_PRESET_IDS).toHaveLength(25);
  expect(NEAT_PRESET_PARAMETERS).toHaveLength(17);
  for (const id of NEAT_PRESET_IDS)
    expect(getBackgroundDescriptor(id).defaults).toEqual(
      NEAT_PRESET_DEFAULTS[id],
    );
  expect(legacy.defaults.resolution).toBe(0.5);
  expect(getBackgroundDescriptor("neat-neat").defaults.resolution).toBe(1);
  expect(getBackgroundDescriptor("neat-neat").defaults.useThemeColors).toBe(
    false,
  );
  expect(getBackgroundDescriptor("neat-alejandra").defaults.speed).toBe(
    0.14868691165357314,
  );
  expect(
    getBackgroundDescriptor("neat-alejandra").defaults.backgroundAlpha,
  ).toBe(0.9998954059507774);
  expect(ORBS_DEFAULT_SCALE_PCT).toBe(47.4);
  for (const state of [
    "orbs-working",
    "orbs-searching",
    "orbs-solving",
    "orbs-listening",
    "orbs-connecting",
    "orbs-weaving",
    "orbs-composing",
    "orbs-breathing",
    "orbs-shaping",
  ] as const)
    expect(getBackgroundDescriptor(state).defaults.scale).toBe(
      ORBS_DEFAULT_SCALE_PCT,
    );
});

test("normalizeNeatConfig validates each editor scalar including nonfinite values and positive blending", () => {
  expect(normalizeNeatConfig({})).toEqual(NEAT_DEFAULTS);
  for (const [key, , fallback, min, max] of NEAT_PARAMETERS) {
    for (const value of [
      NaN,
      Infinity,
      -Infinity,
      undefined,
      null,
      "2",
      true,
      [],
    ])
      expect(normalizeNeatConfig({ [key]: value })[key]).toBe(fallback);
    expect(normalizeNeatConfig({ [key]: -1e9 })[key]).toBe(min);
    expect(normalizeNeatConfig({ [key]: 1e9 })[key]).toBe(max);
    const unsnapped = min + (max - min) * 0.3141592653589793;
    expect(normalizeNeatConfig({ [key]: unsnapped })[key]).toBe(unsnapped);
  }
  expect(normalizeNeatConfig({ colorBlending: 0 }).colorBlending).toBe(0.1);
});

test("neatBufferSize bounds DPR and total pixels without rounding mesh-detail config", () => {
  expect(NEAT_DPR_CAP).toBe(1);
  expect(NEAT_PIXEL_CAP).toBe(2073600);
  expect(neatBufferSize(1920, 1080, 2)).toEqual([1920, 1080]);
  expect(neatBufferSize(3840, 2160, 2)).toEqual([1920, 1080]);
  expect(neatBufferSize(1920, 1080, 0.5)).toEqual([960, 540]);
  expect(neatBufferSize(NaN, Infinity, -1)).toEqual([1, 1]);
  expect(neatBufferSize(-100, 0, NaN)).toEqual([1, 1]);
  expect(neatBufferSize(Number.MAX_VALUE, Number.MAX_VALUE, 1)).toEqual([1, 1]);
  for (const width of [1, 320, 1920, 8000])
    for (const height of [1, 200, 1080, 3000])
      for (const dpr of [-1, 0, NaN, 0.5, 1, 3]) {
        const [w, h] = neatBufferSize(width, height, dpr);
        expect(w).toBeGreaterThanOrEqual(1);
        expect(h).toBeGreaterThanOrEqual(1);
        expect(Number.isInteger(w) && Number.isInteger(h)).toBe(true);
        expect(w * h).toBeLessThanOrEqual(NEAT_PIXEL_CAP);
      }
});

test("neatPaletteColors produces six clamped rounded native RGB stops from active roles", () => {
  const palette: ThemePalette = {
    paper: [0, 0, 0],
    paperHex: "#000000",
    ink: [1, 1, 1],
    inkHex: "#ffffff",
    accent: [1, 0, 0],
    accentHex: "#ff0000",
    focus: [0, 1, 0],
    focusHex: "#00ff00",
    lightTheme: false,
  };
  expect(neatPaletteColors(palette)).toEqual(
    ["#000000", "#590000", "#004d00", "#2e2e2e", "#990000", "#008000"].map(
      (color) => ({ color, enabled: true }),
    ),
  );
  expect(neatPaletteColors({ ...palette, paper: [-1, 2, 0] })[0]?.color).toBe(
    "#00ff00",
  );
  expect(palette.paper).toEqual([0, 0, 0]);
});
