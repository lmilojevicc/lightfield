import { NeatGradient } from "../vendor/neat/NeatGradient";
import {
  NEAT_PARAMETERS,
  neatBufferSize,
  neatPaletteColors,
  normalizeNeatConfig,
} from "../shared/neat-metadata";
import { applyMeridianCanvasFilter } from "./meridian-color-filter";
import type {
  BackgroundContext,
  BackgroundInstance,
  BackgroundUpdateContext,
} from "./runtime/contracts";

/** Native Neat 1.0.2, locally adapted lifecycle; see neat/NOTICE.md. */
export function createNeat(context: BackgroundContext): BackgroundInstance {
  const canvas = document.createElement("canvas");
  canvas.className = "background-canvas";
  canvas.setAttribute("aria-hidden", "true");
  context.host.append(canvas);
  let state: BackgroundUpdateContext = context;
  let gradient: NeatGradient | undefined;
  let destroyed = false;
  const isDestroyed = () => destroyed;
  const currentGradient = () => gradient;
  const size = () =>
    neatBufferSize(
      context.host.clientWidth,
      context.host.clientHeight,
      window.devicePixelRatio,
    );
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    gradient?.destroy();
    canvas.remove();
  };
  const fail = (error: unknown) => {
    destroy();
    context.reportRuntimeFailure(error);
  };
  const style = () => {
    const value = state.config.opacity;
    canvas.style.opacity = String(
      typeof value === "number" && Number.isFinite(value)
        ? Math.min(1, Math.max(0, value))
        : 1,
    );
    applyMeridianCanvasFilter(canvas, state.config);
  };
  try {
    [canvas.width, canvas.height] = size();
    style();
    gradient = new NeatGradient({
      ref: canvas,
      ...normalizeNeatConfig(state.config),
      colors: neatPaletteColors(state.palette),
      backgroundColor: state.palette.paperHex,
      backgroundAlpha: 1,
      colorSaturation: 0,
      cameraLock: true,
      seed: 6,
      textureSeed: 333,
      visible: state.visible,
      reducedMotion: state.reducedMotion,
      onError: fail,
    });
    // Native constructor synchronously calls render() after GL setup; it returns
    // only after that actual first draw (and throws on a failed render).
    context.reportPaint?.();
  } catch (error) {
    destroy();
    throw error;
  }
  return {
    update(next) {
      if (isDestroyed() || !currentGradient()) return;
      state = next;
      try {
        const config = normalizeNeatConfig(state.config);
        for (const [key] of NEAT_PARAMETERS) {
          if (gradient[key] !== config[key]) gradient[key] = config[key];
        }
        gradient.colors = neatPaletteColors(state.palette);
        gradient.backgroundColor = state.palette.paperHex;
        style();
        gradient.setHostState(state.visible, state.reducedMotion);
      } catch (error) {
        fail(error);
      }
    },
    resize() {
      if (isDestroyed() || !currentGradient()) return;
      try {
        gradient.resize(...size());
      } catch (error) {
        fail(error);
      }
    },
    destroy,
  };
}
