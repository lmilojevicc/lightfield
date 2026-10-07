// Adapted from Paper Shaders 0.0.80, Apache-2.0. See THIRD_PARTY_NOTICES.md.
// Official wrapper defaults/prop mappings; Meridian supplies theme colors and lifecycle.
import {
  staticMeshGradientFragmentShader,
  type StaticMeshGradientUniforms,
  ShaderFitOptions,
} from "@paper-design/shaders";
import { createPaperBackground } from "./adapter";
import type { BackgroundFactory } from "../runtime/contracts";

export const create: BackgroundFactory = (context) =>
  createPaperBackground(
    context,
    "paper-static-mesh-gradient",
    staticMeshGradientFragmentShader,
    (config, _palette, colors) =>
      ({
        // Own uniforms
        u_colors: colors,
        u_colorsCount: colors.length,
        u_positions: Number(config.positions),
        u_waveX: Number(config.waveX),
        u_waveXShift: Number(config.waveXShift),
        u_waveY: Number(config.waveY),
        u_waveYShift: Number(config.waveYShift),
        u_mixing: Number(config.mixing),
        u_grainMixer: Number(config.grainMixer),
        u_grainOverlay: Number(config.grainOverlay),

        // Sizing uniforms
        u_fit: ShaderFitOptions[config.fit as keyof typeof ShaderFitOptions],
        u_rotation: Number(config.rotation),
        u_scale: Number(config.scale),
        u_offsetX: Number(config.offsetX),
        u_offsetY: Number(config.offsetY),
        u_originX: Number(config.originX),
        u_originY: Number(config.originY),
        u_worldWidth: 0,
        u_worldHeight: 0,
      }) satisfies StaticMeshGradientUniforms,
  );
