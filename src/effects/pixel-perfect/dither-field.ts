// Adapted from Pixel Perfect by Vansh Nagar; pinned provenance and unresolved terms in docs/pixel-perfect-backgrounds.md.
import { pixelPerfectFactory } from "./adapter";
import { canvasRenderer } from "./canvas";

/** Stable 0–1 value for an integer triple, so a cell's noise never flickers between frames. */
function hash(a: number, b: number, c: number) {
  let h =
    Math.imul(a | 0, 0x27d4eb2d) ^
    Math.imul(b | 0, 0x165667b1) ^
    Math.imul(c | 0, 0x1b873593);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (p: number) => p * p * (3 - 2 * p);
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const mod = (n: number, m: number) => ((n % m) + m) % m;

/** 3D value noise in 0–1: hashed lattice corners, smoothly interpolated. The third axis is time. */
function noise(x: number, y: number, z: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = smooth(x - xi);
  const fy = smooth(y - yi);
  const fz = smooth(z - zi);
  const face = (dz: number) =>
    lerp(
      lerp(hash(xi, yi, zi + dz), hash(xi + 1, yi, zi + dz), fx),
      lerp(hash(xi, yi + 1, zi + dz), hash(xi + 1, yi + 1, zi + dz), fx),
      fy,
    );
  return lerp(face(0), face(1), fz);
}

export const create = pixelPerfectFactory(
  "pixel-perfect-dither-field",
  canvasRenderer((ctx, config, colors) => {
    const pitch = Number(config.spacing),
      zoom = Number(config.blobScale);
    const color = colors.foreground;
    return (width, height, elapsed) => {
      ctx.clearRect(0, 0, width, height);
      if (!width || !height) return;
      const t = elapsed;
      const cols = Math.ceil(width / pitch);
      const rows = Math.ceil(height / pitch);
      // Marks are wide and short, so a run of them reads as a dashed weave rather than dots.
      const markW = pitch * 0.72;
      const markH = pitch * 0.4;
      // Noise coordinates in viewport heights: blobs keep their proportions at any size.
      const step = (pitch / height) * zoom;
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let j = 0; j < rows; j++) {
        const ny = j * step * 2.6;
        for (let i = 0; i < cols; i++) {
          // Every third diagonal stays empty, which is what gives the field its hatched texture.
          if (mod(i - j, 3) === 0) continue;
          const nx = i * step * 1.4 - t * 0.09;
          // A slow warp bends the lattice, so blob edges read organic instead of diagonal.
          const warp = noise(nx * 0.6 + 11, ny * 0.6, t * 0.05);
          const value =
            0.65 * noise(nx + warp * 1.2, ny, t * 0.12) +
            0.35 * noise(nx * 2.3 + 7, ny * 2.3, t * 0.2 + 3);
          if (value < 0.5) continue;
          ctx.rect(
            i * pitch + (pitch - markW) / 2,
            j * pitch + (pitch - markH) / 2,
            markW,
            markH,
          );
        }
      }
      ctx.fill();
    };
  }),
  true,
);
