import { requiredValue } from "../runtime/required-value";
import { NeatGradient } from "../../vendor/neat/current/NeatGradient";
import { neatBufferSize } from "../../shared/neat-metadata";
import {
  NEAT_PRESET_PARAMETERS,
  type NeatPresetId,
} from "../../shared/neat-preset-metadata";
import { neatPresetConfig } from "./preset-config";
import { applyMeridianCanvasFilter } from "../meridian-color-filter";
import type {
  BackgroundContext,
  BackgroundInstance,
  BackgroundUpdateContext,
} from "../runtime/contracts";

/** One lazy current engine shared by all official presets; legacy remains separate. */
export function createNeatPreset(id: NeatPresetId) {
  return function create(context: BackgroundContext): BackgroundInstance {
    const canvas = document.createElement("canvas");
    canvas.className = "background-canvas";
    canvas.setAttribute("aria-hidden", "true");
    context.host.append(canvas);
    let state: BackgroundUpdateContext = context;
    let gradient: NeatGradient | undefined;
    let configSignature = "";
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
      const config = neatPresetConfig(id, state.config, state.palette);
      configSignature = JSON.stringify(config);
      gradient = new NeatGradient({
        ref: canvas,
        ...config,
        seed: 6,
        visible: state.visible,
        reducedMotion: state.reducedMotion,
        onError: fail,
      });
      // Native constructor synchronously renders its first frame before returning.
      context.reportPaint?.();
    } catch (error) {
      destroy();
      throw error;
    }
    return {
      update(next) {
        if (isDestroyed() || !currentGradient()) return;
        const hostChanged =
          state.visible !== next.visible ||
          state.reducedMotion !== next.reducedMotion;
        state = next;
        try {
          const config = neatPresetConfig(id, state.config, state.palette);
          // Config is finite scalar data plus stops, in stable source-key order.
          // Theme notifications create fresh arrays even when native content is unchanged.
          const signature = JSON.stringify(config);
          if (signature === configSignature) {
            style();
            if (hostChanged)
              gradient.setHostState(state.visible, state.reducedMotion);
            return;
          }
          configSignature = signature;
          for (const [key] of NEAT_PRESET_PARAMETERS) {
            if (gradient[key] !== config[key])
              gradient[key] = requiredValue(config[key]);
          }
          gradient.colors = config.colors;
          gradient.backgroundColor = config.backgroundColor ?? "#FFFFFF";
          if (config.fresnelColor) gradient.fresnelColor = config.fresnelColor;
          if (config.proceduralBackgroundColor)
            gradient.proceduralBackgroundColor =
              config.proceduralBackgroundColor;
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
  };
}
