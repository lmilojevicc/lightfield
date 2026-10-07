export const MERIDIAN_COLOR_FILTER_DEFAULTS = {
  brightness: 1,
  saturation: 1,
  contrast: 1,
} as const;

const FILTER_RANGES = {
  brightness: [0.5, 1.5],
  saturation: [0, 2],
  contrast: [0.5, 1.5],
} as const;

type MeridianColorConfig = Readonly<Record<string, unknown>>;

function normalizedFilterValue(
  config: MeridianColorConfig,
  key: keyof typeof FILTER_RANGES,
): number {
  const value = config[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return MERIDIAN_COLOR_FILTER_DEFAULTS[key];
  }
  const [min, max] = FILTER_RANGES[key];
  return Math.min(max, Math.max(min, value));
}

function formatFilterNumber(value: number): string {
  return Number(value.toFixed(2)).toString();
}

export function meridianCanvasFilter(config: MeridianColorConfig): string {
  const brightness = normalizedFilterValue(config, "brightness");
  const saturation = normalizedFilterValue(config, "saturation");
  const contrast = normalizedFilterValue(config, "contrast");
  if (brightness === 1 && saturation === 1 && contrast === 1) return "none";
  return `brightness(${formatFilterNumber(brightness)}) saturate(${formatFilterNumber(saturation)}) contrast(${formatFilterNumber(contrast)})`;
}

export function applyMeridianCanvasFilter(
  canvas: HTMLCanvasElement,
  config: MeridianColorConfig,
): void {
  canvas.style.filter = meridianCanvasFilter(config);
}
