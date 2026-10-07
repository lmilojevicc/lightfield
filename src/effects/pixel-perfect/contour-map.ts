// Adapted from Pixel Perfect by Vansh Nagar; see docs/pixel-perfect-backgrounds.md.
import { pixelPerfectFactory } from "./adapter";
import type { PixelPerfectColors } from "./colors";
import { createProgram, rgb, value } from "./webgl";
import { VERTEX, FRAGMENT } from "./contour-map-shaders";

export const create = pixelPerfectFactory(
  "pixel-perfect-contour-map",
  (canvas, initial, colors) => {
    const program = createProgram(canvas, VERTEX, FRAGMENT, true);
    const { gl, uniform } = program;
    let config = initial,
      dpr = 1;
    const applyColors = (next: PixelPerfectColors) => {
      gl.uniform3fv(uniform("uInk"), rgb(next.foreground));
      gl.uniform3fv(uniform("uPaper"), rgb(next.paper));
    };
    applyColors(colors);
    return {
      configure(next, nextColors) {
        config = next;
        applyColors(nextColors);
      },
      resize(width, height, ratio) {
        dpr = ratio;
        program.resize(width, height, dpr);
      },
      draw(_width, _height, elapsed) {
        gl.uniform1f(uniform("uTime"), elapsed);
        gl.uniform1f(uniform("uLevels"), value(config, "levels"));
        gl.uniform1f(uniform("uWidth"), value(config, "lineWidth") * dpr * 0.5);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      destroy: program.destroy,
    };
  },
);
