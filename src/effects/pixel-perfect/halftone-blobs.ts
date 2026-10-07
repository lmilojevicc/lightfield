import { requiredValue } from "../runtime/required-value";
// Adapted from Pixel Perfect by Vansh Nagar; pinned provenance and unresolved terms in docs/pixel-perfect-backgrounds.md.
import { pixelPerfectFactory } from "./adapter";
import { canvasRenderer } from "./canvas";

export const create = pixelPerfectFactory(
  "pixel-perfect-halftone-blobs",
  canvasRenderer((ctx, config, colors) => {
    const gap = Number(config.spacing),
      count = Math.round(Number(config.blobs));
    const color = colors.foreground;
    // Each blob wanders on its own Lissajous path, so they cross and merge
    // without ever repeating exactly.
    const paths = Array.from({ length: count }, (_, i) => ({
      ax: 0.55 + (0.4 * ((i * 7) % 5)) / 5,
      ay: 0.4 + (0.5 * ((i * 3) % 4)) / 4,
      fx: 0.11 + 0.05 * ((i * 5) % 3),
      fy: 0.09 + 0.06 * ((i * 2) % 4),
      phase: i * 1.7,
      radius: 0.18 + (0.12 * ((i * 4) % 3)) / 3,
    }));

    return (width, height, elapsed) => {
      ctx.clearRect(0, 0, width, height);
      const base = Math.min(width, height);
      const centres = paths.map((p) => ({
        x: width / 2 + Math.sin(elapsed * p.fx + p.phase) * p.ax * width * 0.45,
        y:
          height / 2 +
          Math.cos(elapsed * p.fy + p.phase * 0.7) * p.ay * height * 0.45,
        r: p.radius * base,
      }));
      ctx.fillStyle = color;
      ctx.beginPath();
      const rows = Math.ceil(height / gap) + 1;
      const columns = Math.ceil(width / gap) + 2;
      const maxRadius = gap * 0.58;
      for (let row = 0; row < rows; row++) {
        // Alternate rows shift half a step so the screen reads as a
        // hexagonal lattice rather than a square one.
        const offset = row % 2 ? gap / 2 : 0;
        const y = row * gap;
        for (let column = 0; column < columns; column++) {
          const x = column * gap + offset;
          // Metaball field: inverse-square contributions, summed.
          let v = 0;
          for (let i = 0; i < centres.length; i++) {
            const dx = x - requiredValue(centres[i]).x;
            const dy = y - requiredValue(centres[i]).y;
            v +=
              (requiredValue(centres[i]).r * requiredValue(centres[i]).r) /
              (dx * dx + dy * dy + 1);
          }
          // Soft base tone so the paper is never completely empty.
          const t = Math.min(1, v * 0.42 + 0.05);
          const r = Math.sqrt(t) * maxRadius;
          if (r < 0.35) continue;
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, Math.PI * 2);
        }
      }
      ctx.fill();
    };
  }),
  true,
);
