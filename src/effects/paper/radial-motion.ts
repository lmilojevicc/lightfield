import { ShaderFitOptions } from "@paper-design/shaders";
import type { ShaderSizingAnimation } from "./shader-mount";

/** Taper the amplitude, not the waveform: no clipping or flat spots at control bounds. */
function boundedAmplitude(
  value: number,
  amplitude: number,
  min: number,
  max: number,
): number {
  const headroom = Math.max(0, Math.min(value - min, max - value));
  const t = Math.min(1, headroom / (2 * amplitude));
  return amplitude * t * t * (3 - 2 * t);
}

/** Local sizing motion only; the official radial fragment has no u_time.
 * With zero world dimensions, none/contain use a min(W,H) square; cover uses max.
 * Offsets precede scale/rotation in the vertex shader, so these translations stay
 * viewport-aligned and independent of the user's scale, origin and rotation.
 */
export const radialSizingAnimation: ShaderSizingAnimation = (
  milliseconds,
  baseline,
  width,
  height,
) => {
  const scale = Number(baseline.u_scale);
  const offsetX = Number(baseline.u_offsetX);
  const offsetY = Number(baseline.u_offsetY);
  const side =
    baseline.u_fit === ShaderFitOptions.cover
      ? Math.max(width, height)
      : Math.min(width, height);
  const wave = (period: number) =>
    Math.sin((2 * Math.PI * (milliseconds % period)) / period);
  return {
    u_scale:
      scale + boundedAmplitude(scale, scale * 0.02, 0.01, 4) * wave(50_000),
    u_offsetX:
      offsetX +
      boundedAmplitude(offsetX, (0.01 * width) / side, -1, 1) * wave(45_000),
    u_offsetY:
      offsetY +
      boundedAmplitude(offsetY, (0.01 * height) / side, -1, 1) * wave(60_000),
  };
};
