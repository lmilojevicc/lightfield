export type NumericControlKey =
  "ArrowRight" | "ArrowUp" | "ArrowLeft" | "ArrowDown" | "Home" | "End";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function stepDecimals(step: number): number {
  const value = step.toString();
  const dot = value.indexOf(".");
  return dot === -1 ? 0 : value.length - dot - 1;
}

function roundToStep(value: number, step: number, min: number): number {
  const raw = Math.round((value - min) / step) * step + min;
  return Number(raw.toFixed(Math.max(stepDecimals(step), stepDecimals(min))));
}

export function numericControlPercentage(
  value: number,
  min: number,
  max: number,
): number {
  const range = max - min;
  return range > 0 ? ((value - min) / range) * 100 : 0;
}

export function numericControlAriaValues(
  value: number,
  min: number,
  max: number,
): { valueNow: number; valueText: string | null } {
  const valueNow = clamp(value, min, max);
  if (value < min)
    return {
      valueNow,
      valueText: `Effective value ${String(value)}, below minimum ${String(min)}`,
    };
  if (value > max)
    return {
      valueNow,
      valueText: `Effective value ${String(value)}, above maximum ${String(max)}`,
    };
  return { valueNow, valueText: null };
}

export function numericControlPointerValue(
  clientX: number,
  left: number,
  width: number,
  min: number,
  max: number,
  step: number,
): number {
  const ratio = clamp((clientX - left) / width, 0, 1);
  return clamp(roundToStep(min + ratio * (max - min), step, min), min, max);
}

export function numericControlKeyTransition(
  value: number,
  key: string,
  min: number,
  max: number,
  step: number,
): number | null {
  let next: number;
  switch (key as NumericControlKey) {
    case "ArrowRight":
    case "ArrowUp":
      next = value + step;
      break;
    case "ArrowLeft":
    case "ArrowDown":
      next = value - step;
      break;
    case "Home":
      next = min;
      break;
    case "End":
      next = max;
      break;
    default:
      return null;
  }
  return clamp(roundToStep(next, step, min), min, max);
}

/** Native ranges sanitize authored off-lattice Neat values; use the source bounded adapter instead. */
export function numericControlNeedsAdapter(
  value: number,
  source: string,
  min: number,
  max: number,
  step: number,
): boolean {
  return (
    value < min ||
    value > max ||
    (source.startsWith("neat-") &&
      source !== "neat-gradient" &&
      Math.abs((value - min) / step - Math.round((value - min) / step)) > 1e-8)
  );
}
