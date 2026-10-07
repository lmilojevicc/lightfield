import { requiredValue } from "../runtime/required-value";
// Adapted from Pixel Perfect by Vansh Nagar; pinned provenance and unresolved terms in docs/pixel-perfect-backgrounds.md.
import { pixelPerfectFactory } from "./adapter";
import { canvasRenderer } from "./canvas";

const GLYPHS = [
  { min: 15, char: "·" },
  { min: 50, char: "/" },
  { min: 100, char: "$" },
  { min: 160, char: "£" },
];

function waves(x: number, y: number, time: number) {
  return (
    Math.sin(0.8 * x + 0.3 * time) * Math.cos(0.6 * y + 0.2 * time) * 0.5 +
    0.25 * Math.sin(1.6 * x + 1.2 * y + 0.15 * time) +
    Math.sin(0.3 * x - 0.4 * time) * Math.cos(0.4 * y + 0.25 * time) * 0.6 +
    0.3 * Math.sin(0.5 * (x + y) + 0.35 * time) +
    Math.sin(2.5 * x + 0.1 * time) * Math.cos(2.8 * y - 0.12 * time) * 0.15
  );
}

function brightness(x: number, y: number, time: number, spacing: number) {
  const field =
    waves(x, y, time) +
    0.4 * waves(x * 2.2, y * 2.2, time * 0.7) +
    0.15 * waves(x * 4.5, y * 4.5, time * 0.4);
  const value = Math.max(0, Math.min(1, (field + 1.8) / 3.6));
  const band = (value % spacing) / spacing;
  const contour = band < 0.12 || band > 0.88;
  let light = Math.round(contour ? 200 * value + 55 : 140 * value);
  if (contour) {
    const dx = waves(x + 0.01, y, time) - waves(x - 0.01, y, time);
    const dy = waves(x, y + 0.01, time) - waves(x, y - 0.01, time);
    const slope = 12 * Math.hypot(dx, dy);
    if (slope > 0.5) light = Math.min(255, light + Math.round(40 * slope));
  }
  return light;
}

export const create = pixelPerfectFactory(
  "pixel-perfect-currency-sky",
  canvasRenderer((ctx, config, colors) => {
    const cw = Number(config.cellWidth),
      ch = Number(config.cellHeight),
      size = Number(config.fontSize);
    const scale = Number(config.terrainScale),
      spacing = Number(config.contourSpacing),
      alpha = Number(config.opacity);
    const fontFamily = "ui-monospace, monospace";
    // Reuse color buckets instead of changing fillStyle for every cell.
    const buckets: number[][] = GLYPHS.map(() => []);
    return (width, height, elapsed) => {
      ctx.clearRect(0, 0, width, height);
      ctx.font = `400 ${String(size)}px ${fontFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.globalAlpha = alpha;
      buckets.forEach((bucket) => {
        bucket.length = 0;
      });
      const columns = Math.ceil(width / cw) + 1;
      const rows = Math.ceil(height / ch) + 1;
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          const value = brightness(
            (column + 0.5) * scale,
            (row + 0.5) * scale,
            elapsed,
            spacing,
          );
          for (let i = GLYPHS.length - 1; i >= 0; i--) {
            if (value >= requiredValue(GLYPHS[i]).min) {
              requiredValue(buckets[i]).push(
                column * cw + cw / 2,
                row * ch + ch / 2,
              );
              break;
            }
          }
        }
      }
      buckets.forEach((bucket, index) => {
        ctx.fillStyle = requiredValue(colors.currencyTiers[index]);
        for (let i = 0; i < bucket.length; i += 2)
          ctx.fillText(
            requiredValue(GLYPHS[index]).char,
            requiredValue(bucket[i]),
            requiredValue(bucket[i + 1]),
          );
      });
      ctx.globalAlpha = 1;
    };
  }),
  true,
);
