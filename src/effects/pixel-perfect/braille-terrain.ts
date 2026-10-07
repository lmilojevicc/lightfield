import { requiredValue } from "../runtime/required-value";
// Adapted from Pixel Perfect by Vansh Nagar; pinned provenance and unresolved terms in docs/pixel-perfect-backgrounds.md.
import { pixelPerfectFactory } from "./adapter";
import { canvasRenderer } from "./canvas";

/** Braille dot bit for each of the 2×4 sub-cells, column-major. */
const DOT_BITS = [0x01, 0x02, 0x04, 0x40, 0x08, 0x10, 0x20, 0x80];
/**
 * Ordered thresholds for the eight sub-cells, so a cell's brightness maps to
 * how many dots light up rather than to a hard on/off edge.
 */
const DOT_ORDER = [0.06, 0.56, 0.31, 0.81, 0.43, 0.93, 0.18, 0.68];

function field(x: number, y: number, t: number) {
  return (
    Math.sin(0.9 * x + 0.25 * t) * Math.cos(0.7 * y - 0.18 * t) * 0.5 +
    0.3 * Math.sin(1.7 * x - 1.1 * y + 0.22 * t) +
    Math.sin(0.35 * x + 0.3 * t) * Math.cos(0.45 * y + 0.2 * t) * 0.55 +
    0.2 * Math.sin(3.1 * x + 0.12 * t) * Math.cos(2.7 * y - 0.1 * t)
  );
}

export const create = pixelPerfectFactory(
  "pixel-perfect-braille-terrain",
  canvasRenderer((ctx, config, colors) => {
    const cw = Number(config.cellSize),
      ch = cw * 1.6,
      zoom = Number(config.scale),
      alpha = Number(config.opacity);
    const color = colors.foreground;
    // Three brightness buckets, one fillStyle each, instead of a colour per cell.
    const tiers = [
      { min: 0.1, alpha: 0.3 },
      { min: 0.4, alpha: 0.62 },
      { min: 0.66, alpha: 1 },
    ];
    const buckets: (number | string)[][] = tiers.map(() => []);

    return (width, height, elapsed) => {
      ctx.clearRect(0, 0, width, height);
      ctx.font = `400 ${String(cw * 1.25)}px ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      buckets.forEach((bucket) => {
        bucket.length = 0;
      });
      const columns = Math.ceil(width / cw) + 1;
      const rows = Math.ceil(height / ch) + 1;
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          let bits = 0;
          let sum = 0;
          for (let dot = 0; dot < 8; dot++) {
            const sx = column + (dot < 4 ? 0.25 : 0.75);
            const sy = row + ((dot % 4) + 0.5) / 4;
            const raw =
              (field(sx * zoom * 2, sy * zoom * 2 * 1.6, elapsed) + 1.55) / 3.1;
            // Push the mid-tones apart so hills read as hills, not haze.
            const v = raw < 0.5 ? 2 * raw * raw : 1 - 2 * (1 - raw) * (1 - raw);
            sum += v;
            if (v > requiredValue(DOT_ORDER[dot]))
              bits |= requiredValue(DOT_BITS[dot]);
          }
          // An empty cell still gets one faint dot, so valleys read as dark
          // ground rather than holes in the grid.
          if (!bits) bits = 0x02;
          const mean = sum / 8;
          for (let i = tiers.length - 1; i >= 0; i--) {
            if (mean >= requiredValue(tiers[i]).min) {
              requiredValue(buckets[i]).push(
                String.fromCharCode(0x2800 + bits),
                column * cw + cw / 2,
                row * ch + ch / 2,
              );
              break;
            }
          }
        }
      }
      buckets.forEach((bucket, index) => {
        ctx.globalAlpha = alpha * requiredValue(tiers[index]).alpha;
        ctx.fillStyle = color;
        for (let i = 0; i < bucket.length; i += 3)
          ctx.fillText(
            bucket[i] as string,
            bucket[i + 1] as number,
            bucket[i + 2] as number,
          );
      });
      ctx.globalAlpha = 1;
    };
  }),
  true,
);
