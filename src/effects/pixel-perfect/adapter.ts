import type {
  BackgroundFactory,
  BackgroundUpdateContext,
} from "../runtime/contracts";
import {
  normalizePixelPerfectConfig,
  type PixelPerfectConfig,
  type PixelPerfectId,
} from "../../shared/pixel-perfect-metadata";

import { resolvePixelPerfectColors, type PixelPerfectColors } from "./colors";

export interface PixelPerfectRenderer {
  draw(width: number, height: number, elapsed: number): void;
  resize(width: number, height: number, dpr: number): void;
  configure(config: PixelPerfectConfig, colors: PixelPerfectColors): void;
  pointer?(event: PointerEvent): void;
  resetPointer?(): void;
  destroy(): void;
}
export type RendererFactory = (
  canvas: HTMLCanvasElement,
  config: PixelPerfectConfig,
  colors: PixelPerfectColors,
) => PixelPerfectRenderer;

/** Full-window lifecycle belongs to the app controller, not React or a second visibility observer. */
export function pixelPerfectFactory(
  id: PixelPerfectId,
  factory: RendererFactory,
  everyOtherFrame = false,
): BackgroundFactory {
  return (context) => {
    let state: BackgroundUpdateContext = context;
    let config = normalizePixelPerfectConfig(id, state.config);
    let colors = resolvePixelPerfectColors(id, state.palette);
    let frame = 0,
      previous = 0,
      elapsed = 0,
      frameNumber = 0;
    let width = 0,
      height = 0,
      destroyed = false,
      listening = false;
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText = `position:absolute;inset:0;width:100%;height:100%;pointer-events:none;background:${colors.paper}`;
    context.host.append(canvas);
    let renderer: PixelPerfectRenderer;
    try {
      renderer = factory(canvas, config, colors);
    } catch (error) {
      canvas.remove();
      throw error;
    }
    const canAnimate = () =>
      state.visible &&
      !state.reducedMotion &&
      !config.paused &&
      Number(config.speed) > 0;
    const draw = () => {
      renderer.draw(width, height, elapsed);
      context.reportPaint?.();
    };
    const move = (event: PointerEvent) => renderer.pointer?.(event);
    const resetPointer = () => renderer.resetPointer?.();
    const syncPointer = () => {
      const next = !!renderer.pointer && !!config.interactive && canAnimate();
      if (next === listening) return;
      listening = next;
      if (next) {
        window.addEventListener("pointermove", move, { passive: true });
        window.addEventListener("blur", resetPointer);
      } else {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("blur", resetPointer);
        resetPointer();
      }
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const destroy = () => {
      if (destroyed) return;
      destroyed = true;
      stop();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("blur", resetPointer);
      canvas.removeEventListener("webglcontextlost", lost);
      renderer.destroy();
      canvas.remove();
    };
    const fail = (error: unknown) => {
      destroy();
      context.reportRuntimeFailure(error);
    };
    const lost = (event: Event) => {
      event.preventDefault();
      fail(new Error("Pixel Perfect WebGL context lost"));
    };
    const tick = (now: number) => {
      frame = 0;
      if (destroyed || !canAnimate()) return;
      elapsed +=
        Math.max(0, Math.min((now - previous) / 1000, 0.1)) *
        Number(config.speed);
      previous = now;
      try {
        if (!everyOtherFrame || ++frameNumber % 2 === 0) draw();
      } catch (error) {
        fail(error);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    const refresh = () => {
      stop();
      syncPointer();
      if (!state.visible) return;
      if (state.reducedMotion)
        elapsed = id === "pixel-perfect-dither-field" ? 2 : 0;
      draw();
      if (canAnimate()) {
        previous = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };
    const resize = () => {
      if (destroyed) return;
      width = context.host.clientWidth;
      height = context.host.clientHeight;
      if (!state.visible) {
        stop();
        syncPointer();
        return;
      }
      renderer.resize(width, height, Math.min(window.devicePixelRatio || 1, 2));
      refresh();
    };
    canvas.addEventListener("webglcontextlost", lost);
    try {
      resize();
    } catch (error) {
      destroy();
      throw error;
    }
    return {
      update(next) {
        if (destroyed) return;
        state = next;
        config = normalizePixelPerfectConfig(id, next.config);
        colors = resolvePixelPerfectColors(id, next.palette);
        canvas.style.background = colors.paper;
        if (state.visible) renderer.configure(config, colors);
        resize();
      },
      resize,
      destroy,
    };
  };
}
