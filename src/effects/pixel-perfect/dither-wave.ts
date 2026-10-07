// Adapted from Pixel Perfect by Vansh Nagar; see docs/pixel-perfect-backgrounds.md.
import { pixelPerfectFactory } from "./adapter";
import type { PixelPerfectColors } from "./colors";
import { createProgram, rgb, value } from "./webgl";
import { VERTEX, FRAGMENT } from "./dither-wave-shaders";

/** Native equivalents of the source's power3.out / power2.out pointer tweens. */
export function easedValue(
  from: number,
  to: number,
  progress: number,
  power: number,
): number {
  return (
    from +
    (to - from) * (1 - Math.pow(1 - Math.max(0, Math.min(1, progress)), power))
  );
}
export const create = pixelPerfectFactory(
  "pixel-perfect-dither-wave",
  (canvas, initial, colors) => {
    const program = createProgram(canvas, VERTEX, FRAGMENT);
    const { gl, uniform } = program;
    let config = initial,
      dpr = 1;
    const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
    const mouse = { x: 0.5, y: 0.5, strength: 0 };
    let fromX = 0.5,
      fromY = 0.5,
      targetX = 0.5,
      targetY = 0.5,
      positionStart = 0;
    let fromStrength = 0,
      targetStrength = 0,
      strengthStart = 0,
      inside = false;
    const advance = (now: number) => {
      mouse.x = easedValue(fromX, targetX, (now - positionStart) / 500, 4);
      mouse.y = easedValue(fromY, targetY, (now - positionStart) / 500, 4);
      mouse.strength = easedValue(
        fromStrength,
        targetStrength,
        (now - strengthStart) / (inside ? 400 : 600),
        3,
      );
    };
    const resetPointer = () => {
      fromX = targetX = mouse.x = 0.5;
      fromY = targetY = mouse.y = 0.5;
      fromStrength = targetStrength = mouse.strength = 0;
      inside = false;
    };
    finePointer.addEventListener("change", resetPointer);
    const applyColors = (next: PixelPerfectColors) => {
      gl.uniform3fv(uniform("uInkA"), rgb(next.foreground));
      gl.uniform3fv(uniform("uInkB"), rgb(next.paper));
    };
    applyColors(colors);
    gl.uniform4f(uniform("uCalm"), 0, 0, 0, 0);
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
        advance(performance.now());
        gl.uniform1f(uniform("uTime"), elapsed);
        gl.uniform1f(uniform("uCell"), value(config, "pixelSize") * dpr);
        gl.uniform1f(uniform("uBias"), value(config, "density"));
        gl.uniform3f(uniform("uMouse"), mouse.x, mouse.y, mouse.strength);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      pointer(event) {
        if (!finePointer.matches || event.pointerType === "touch") return;
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const x = (event.clientX - rect.left) / rect.width;
        const y = 1 - (event.clientY - rect.top) / rect.height;
        const now = performance.now();
        advance(now);
        const nextInside = x >= 0 && x <= 1 && y >= 0 && y <= 1;
        if (inside !== nextInside) {
          inside = nextInside;
          fromStrength = mouse.strength;
          targetStrength = inside ? 1 : 0;
          strengthStart = now;
        }
        if (inside) {
          fromX = mouse.x;
          fromY = mouse.y;
          targetX = x;
          targetY = y;
          positionStart = now;
        }
      },
      resetPointer,
      destroy() {
        finePointer.removeEventListener("change", resetPointer);
        program.destroy();
      },
    };
  },
);
