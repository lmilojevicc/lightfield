// FireCMS Neat legacy 1.0.2 editor metadata and pure conversions; see THIRD_PARTY_NOTICES.md (MIT).
import type { NumberControl } from "./control-types";
import type { ThemePalette } from "./theme";

/** Public Neat editor units; resolution is mesh subdivision, never canvas DPR. */
export const NEAT_PARAMETERS = [
  ["speed", "Speed", 2.5, 0, 10, 0.5],
  ["waveAmplitude", "Wave height", 5, 0, 10, 0.1],
  ["waveFrequencyX", "Wave frequency X", 2, 0, 10, 0.1],
  ["waveFrequencyY", "Wave frequency Y", 3, 0, 10, 0.1],
  ["horizontalPressure", "Horizontal pressure", 3, 0, 10, 0.1],
  ["verticalPressure", "Vertical pressure", 4, 0, 10, 0.1],
  ["colorBlending", "Color blending", 8, 0.1, 10, 0.1],
  ["grainIntensity", "Grain", 0, 0, 1, 0.025],
  ["colorBrightness", "Gradient brightness", 1, 0, 10, 0.05],
  ["highlights", "Highlights", 5, 0, 10, 0.1],
  ["shadows", "Shadows", 1, 0, 10, 0.1],
  ["resolution", "Mesh detail", 0.5, 0.25, 1, 0.05],
] as const;
export const NEAT_DEFAULTS = {
  speed: NEAT_PARAMETERS[0][2],
  waveAmplitude: NEAT_PARAMETERS[1][2],
  waveFrequencyX: NEAT_PARAMETERS[2][2],
  waveFrequencyY: NEAT_PARAMETERS[3][2],
  horizontalPressure: NEAT_PARAMETERS[4][2],
  verticalPressure: NEAT_PARAMETERS[5][2],
  colorBlending: NEAT_PARAMETERS[6][2],
  grainIntensity: NEAT_PARAMETERS[7][2],
  colorBrightness: NEAT_PARAMETERS[8][2],
  highlights: NEAT_PARAMETERS[9][2],
  shadows: NEAT_PARAMETERS[10][2],
  resolution: NEAT_PARAMETERS[11][2],
};
export const NEAT_CONTROLS: readonly NumberControl[] = NEAT_PARAMETERS.map(
  ([key, label, , min, max, step]) => ({
    key,
    label,
    type: "number",
    min,
    max,
    step,
  }),
);
export type NeatParameter = (typeof NEAT_PARAMETERS)[number][0];
export function normalizeNeatConfig(
  config: Readonly<Record<string, unknown>>,
): Record<NeatParameter, number> {
  const result: Record<NeatParameter, number> = { ...NEAT_DEFAULTS };
  for (const [key, , fallback, min, max] of NEAT_PARAMETERS) {
    const value = config[key];
    result[key] =
      typeof value === "number" && Number.isFinite(value)
        ? Math.min(max, Math.max(min, value))
        : fallback;
  }
  return result;
}

export const NEAT_PIXEL_CAP = 1920 * 1080;
export const NEAT_DPR_CAP = 1;
export function neatBufferSize(
  width: number,
  height: number,
  dpr: number,
): [number, number] {
  width = Math.max(1, Number.isFinite(width) ? width : 1);
  height = Math.max(1, Number.isFinite(height) ? height : 1);
  const scale = Math.min(
    Number.isFinite(dpr) && dpr > 0 ? dpr : 1,
    NEAT_DPR_CAP,
    Math.sqrt(NEAT_PIXEL_CAP / (width * height)),
  );
  return [
    Math.max(1, Math.floor(width * scale)),
    Math.max(1, Math.floor(height * scale)),
  ];
}

/** Six native RGB stops derived entirely from active theme roles. */
export function neatPaletteColors(
  palette: ThemePalette,
): { color: string; enabled: boolean }[] {
  const mix = (role: readonly number[], amount: number) =>
    "#" +
    palette.paper
      .map((paper, i) =>
        Math.round(
          Math.min(
            1,
            Math.max(0, paper + ((role[i] ?? paper) - paper) * amount),
          ) * 255,
        )
          .toString(16)
          .padStart(2, "0"),
      )
      .join("");
  return [
    mix(palette.paper, 0),
    mix(palette.accent, 0.35),
    mix(palette.focus, 0.3),
    mix(palette.ink, 0.18),
    mix(palette.accent, 0.6),
    mix(palette.focus, 0.5),
  ].map((color) => ({ color, enabled: true }));
}
