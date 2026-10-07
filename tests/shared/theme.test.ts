import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  BUILTIN_THEME_IDS,
  ISLAND_THEME_PALETTES,
  hexToRgb,
  resolveShaderPalette,
  type PaletteStops,
  type ThemePalette,
} from "../../src/shared/theme";

const palette: ThemePalette = {
  paper: [0, 0, 0],
  paperHex: "#000000",
  ink: [1, 1, 1],
  inkHex: "#ffffff",
  accent: [1, 0.5, 0.25],
  accentHex: "#ff8040",
  focus: [0, 1, 0],
  focusHex: "#00ff00",
  lightTheme: false,
};

test("palette.ts exact 36 built-ins plus seven alias/demo shader palettes", () => {
  // Captured from source palette exports at 3e3116215c98475e3ee5c4043119ff6b86aa211f.
  expect(
    createHash("sha256")
      .update(JSON.stringify(ISLAND_THEME_PALETTES))
      .digest("hex"),
  ).toBe("9cef7888a9cec8ff63d4751e6df38ed896be6a8f63011e870dd1b8fc06a53786");
  expect(BUILTIN_THEME_IDS).toHaveLength(36);
  expect(new Set(BUILTIN_THEME_IDS).size).toBe(36);
  expect(Object.keys(ISLAND_THEME_PALETTES).slice(0, 36)).toEqual([
    ...BUILTIN_THEME_IDS,
  ]);
  expect(Object.keys(ISLAND_THEME_PALETTES)).toHaveLength(43);
  expect(ISLAND_THEME_PALETTES["rose-pine"]).toEqual(
    ISLAND_THEME_PALETTES.rosepine,
  );
  for (const stops of Object.values(ISLAND_THEME_PALETTES))
    for (const hex of stops) expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
});

test("hexToRgb preserves normalized channel values and source invalid-hex behavior", () => {
  expect(hexToRgb("#ff8040")).toEqual([1, 128 / 255, 64 / 255]);
  expect(hexToRgb("#AaBbCc")).toEqual([170 / 255, 187 / 255, 204 / 255]);
  expect(hexToRgb("#00000000")).toEqual([0, 0, 0]);
  expect(hexToRgb("#zzzzzz").every(Number.isNaN)).toBe(true);
});

test("resolveShaderPalette retains explicit > active theme > light/day-night > role interpolation precedence", () => {
  const explicit: PaletteStops = [
    [0.1, 0.2, 0.3],
    [0.2, 0.3, 0.4],
    [0.3, 0.4, 0.5],
    [0.4, 0.5, 0.6],
  ];
  const authored = {
    night: ["#000000", "#111111", "#222222", "#333333"],
    day: ["#ffffff", "#eeeeee", "#dddddd", "#cccccc"],
  };
  expect(
    resolveShaderPalette(
      { ...palette, shaderPalette: explicit },
      authored,
      "midnight",
    ),
  ).toEqual(explicit);
  const midnight = ISLAND_THEME_PALETTES.midnight;
  if (!midnight) throw new Error("Missing midnight palette");
  expect([...resolveShaderPalette(palette, authored, "midnight")]).toEqual(
    midnight.map(hexToRgb),
  );
  expect([
    ...resolveShaderPalette({ ...palette, lightTheme: true }, authored),
  ]).toEqual(authored.day.map(hexToRgb));
  expect([...resolveShaderPalette(palette, authored)]).toEqual(
    authored.night.map(hexToRgb),
  );
  expect([...resolveShaderPalette(palette, { day: authored.day })]).toEqual(
    authored.day.map(hexToRgb),
  );
  expect([
    ...resolveShaderPalette(
      { ...palette, lightTheme: true },
      { night: authored.night },
    ),
  ]).toEqual(authored.night.map(hexToRgb));
  const interpolated: PaletteStops = [
    [0, 0, 0],
    [0.3, 0.15, 0.075],
    [0.7, 0.35, 0.175],
    [1, 0.5, 0.25],
  ];
  expect(resolveShaderPalette(palette, undefined, "custom:example")).toEqual(
    interpolated,
  );
  expect(resolveShaderPalette(palette, { night: ["#ffffff"] })).toEqual(
    interpolated,
  );
  const sparse: string[] = [];
  sparse.length = 4;
  expect(() => resolveShaderPalette(palette, { night: sparse })).toThrow(
    TypeError,
  );
  const resolved = resolveShaderPalette({
    ...palette,
    shaderPalette: explicit,
  });
  resolved[0][0] = 1;
  expect(explicit[0][0]).toBe(0.1);
  const fallback = resolveShaderPalette(palette);
  fallback[0][0] = 1;
  expect(palette.paper[0]).toBe(0);
});
