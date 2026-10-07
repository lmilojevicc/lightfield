import { requiredValue } from "../runtime/required-value";
import {
  NEAT_PRESET_DEFAULTS,
  NEAT_PRESET_PARAMETERS,
  type NeatPresetId,
} from "../../shared/neat-preset-metadata";
import { NEAT_PRESETS } from "./presets";
import type { NeatConfig } from "../../vendor/neat/current/types";
import type { ThemePalette } from "../runtime/contracts";
import { neatPaletteColors } from "../../shared/neat-metadata";

/** Source config is authoritative; only explicitly exposed scalar overrides replace it. */
export function neatPresetConfig(
  id: NeatPresetId,
  values: Readonly<Record<string, unknown>>,
  palette: ThemePalette,
): NeatConfig {
  const source: NeatConfig = NEAT_PRESETS[id];
  const config: NeatConfig = {
    ...source,
    colors: source.colors.map((color) => ({ ...color })),
  };
  for (const [key, , min, max] of NEAT_PRESET_PARAMETERS) {
    const value = values[key];
    // Defaults must remain bit-for-bit source values, not quantized to slider steps.
    // Descriptor bounds also protect direct adapter inputs: blending must stay
    // positive (>= 0.1) to avoid the source shader's equal-edge smoothstep.
    config[key] =
      typeof value === "number" && Number.isFinite(value)
        ? Math.min(max, Math.max(min, value))
        : (NEAT_PRESET_DEFAULTS[id][key] as number);
  }
  if (values.useThemeColors === true) {
    const theme = neatPaletteColors(palette);
    config.colors = source.colors.map((color, index) => ({
      ...color,
      color: requiredValue(theme[index % theme.length]).color,
    }));
    config.backgroundColor = palette.paperHex;
    if (source.fresnelColor) config.fresnelColor = palette.paperHex;
    if (source.proceduralBackgroundColor)
      config.proceduralBackgroundColor = palette.paperHex;
  }
  return config;
}
