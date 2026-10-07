import { requiredValue } from "../../../src/effects/runtime/required-value";
import { test, expect } from "bun:test";
import { createHash } from "node:crypto";
import { NEAT_PRESETS } from "../../../src/effects/neat/presets";
import {
  NEAT_PRESET_IDS,
  NEAT_PRESET_NAMES,
  NEAT_PRESET_PARAMETERS,
} from "../../../src/shared/neat-preset-metadata";
import { neatPresetConfig } from "../../../src/effects/neat/preset-config";
import {
  effectiveBackgroundConfig,
  normalizeBackgroundOverrides,
  NEAT_COLLECTION,
} from "../../../src/shared/background-metadata";
import { neatPaletteColors } from "../../../src/shared/neat-metadata";
import type { ThemePalette } from "../../../src/effects/runtime/contracts";
const palette: ThemePalette = {
  paper: [0, 0, 0],
  ink: [1, 1, 1],
  accent: [0.5, 0.5, 0.5],
  focus: [0.7, 0.7, 0.7],
  paperHex: "#000000",
  inkHex: "#ffffff",
  accentHex: "#808080",
  focusHex: "#b3b3b3",
  lightTheme: false,
};

test("neatPresetConfig colorBlending bounds protect direct and persisted inputs without quantizing defaults", () => {
  expect(
    NEAT_PRESET_PARAMETERS.find(([key]) => key === "colorBlending")?.[2],
  ).toBe(0.1);
  for (const id of NEAT_PRESET_IDS) {
    const original = NEAT_PRESETS[id].colorBlending;
    for (const value of [0, -1]) {
      expect(
        neatPresetConfig(id, { colorBlending: value }, palette).colorBlending,
      ).toBe(0.1);
      const normalized = normalizeBackgroundOverrides({
        [id]: { colorBlending: value },
      });
      expect(effectiveBackgroundConfig(id, normalized).colorBlending).toBe(0.1);
    }
    for (const value of [NaN, Infinity, -Infinity, undefined]) {
      expect(
        neatPresetConfig(id, { colorBlending: value }, palette).colorBlending,
      ).toBe(original);
      const normalized = normalizeBackgroundOverrides({
        [id]: { colorBlending: value },
      });
      expect(effectiveBackgroundConfig(id, normalized).colorBlending).toBe(
        original,
      );
    }
    for (const value of [0.1, 3.4364342889372583, 5, 10]) {
      expect(
        neatPresetConfig(id, { colorBlending: value }, palette).colorBlending,
      ).toBe(value);
    }
    expect(neatPresetConfig(id, {}, palette).colorBlending).toBe(original);
  }
});

test("official-presets pinned fixture: exact 25 names, IDs and typed engine config values", async () => {
  const source = await Bun.file(
    new URL(
      "../../../src/vendor/neat/official-presets.ts.fixture",
      import.meta.url,
    ),
  ).text();
  expect(createHash("sha256").update(source).digest("hex")).toBe(
    "6e4bebb1cd26344bee5aafe294605d412ee013af010cfa87001cc5d23650bb2b",
  );
  const js = new Bun.Transpiler({ loader: "ts" }).transformSync(source);
  const { PRESETS } = (await import(
    `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
  )) as { PRESETS: Record<string, Record<string, unknown>> };
  expect(Object.keys(PRESETS)).toHaveLength(25);
  expect(NEAT_PRESET_IDS).toHaveLength(25);
  expect(NEAT_COLLECTION.ids).toHaveLength(26);
  for (const [name, sourceConfig] of Object.entries(PRESETS)) {
    const id =
      `neat-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` as (typeof NEAT_PRESET_IDS)[number];
    expect(NEAT_PRESET_NAMES[id]).toBe(name);
    expect(sourceConfig).toEqual(NEAT_PRESETS[id]);
    expect(Object.isFrozen(NEAT_PRESETS[id].colors)).toBe(true);
    const defaults = effectiveBackgroundConfig(id, {});
    const rendered = neatPresetConfig(id, defaults, palette);
    for (const [key, value] of Object.entries(sourceConfig as object))
      expect(rendered[key as keyof typeof rendered] as unknown).toEqual(value);
    expect(defaults.useThemeColors).toBe(false);
    for (const [key, , min, max] of NEAT_PRESET_PARAMETERS) {
      expect(defaults[key] as number).toBeGreaterThanOrEqual(min);
      expect(defaults[key] as number).toBeLessThanOrEqual(max);
    }
    const overridden = normalizeBackgroundOverrides({
      [id]: { speed: 0, useThemeColors: true },
      "neat-gradient": { speed: 3, resolution: 0.7 },
    });
    expect(effectiveBackgroundConfig(id, overridden).speed).toBe(0);
    Reflect.deleteProperty(overridden, id); // same per-card Reset semantics as settings
    expect(effectiveBackgroundConfig(id, overridden)).toEqual(defaults);
    expect(overridden["neat-gradient"]).toEqual({ speed: 3, resolution: 0.7 });
    expect(
      requiredValue(
        neatPresetConfig(id, { ...defaults, useThemeColors: true }, palette)
          .colors[0],
      ).color,
    ).toBe(requiredValue(neatPaletteColors(palette)[0]).color);
  }
});
