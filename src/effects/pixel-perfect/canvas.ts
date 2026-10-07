import type { PixelPerfectConfig } from "../../shared/pixel-perfect-metadata";
import type { RendererFactory } from "./adapter";

import type { PixelPerfectColors } from "./colors";

export type CanvasPainter = (
  width: number,
  height: number,
  elapsed: number,
) => void;
export function canvasRenderer(
  makePainter: (
    ctx: CanvasRenderingContext2D,
    config: PixelPerfectConfig,
    colors: PixelPerfectColors,
  ) => CanvasPainter,
): RendererFactory {
  return (canvas, config, colors) => {
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("Pixel Perfect Canvas 2D unavailable");
    let painter = makePainter(ctx, config, colors);
    return {
      draw: (width, height, elapsed) => {
        painter(width, height, elapsed);
      },
      configure: (next, nextColors) => {
        painter = makePainter(ctx, next, nextColors);
      },
      resize(width, height, dpr) {
        canvas.width = Math.max(1, Math.floor(width * dpr));
        canvas.height = Math.max(1, Math.floor(height * dpr));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      },
      destroy() {
        canvas.width = canvas.height = 1;
      },
    };
  };
}
