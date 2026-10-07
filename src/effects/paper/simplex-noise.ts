// Adapted from Paper Shaders 0.0.80, Apache-2.0. See THIRD_PARTY_NOTICES.md.
// Official wrapper defaults/prop mappings; Meridian supplies theme colors and lifecycle.
import {
  simplexNoiseFragmentShader,
  type SimplexNoiseUniforms,
  ShaderFitOptions,
} from "@paper-design/shaders";
import { createPaperBackground } from "./adapter";
import type { BackgroundFactory } from "../runtime/contracts";

export const create: BackgroundFactory = (context) =>
  createPaperBackground(
    context,
    "paper-simplex-noise",
    simplexNoiseFragmentShader,
    (config, _palette, colors) =>
      ({
        // Own uniforms
        u_colors: colors,
        u_colorsCount: colors.length,
        u_stepsPerColor: Number(config.stepsPerColor),
        u_softness: Number(config.softness),

        // Sizing uniforms
        u_fit: ShaderFitOptions[config.fit as keyof typeof ShaderFitOptions],
        u_scale: Number(config.scale),
        u_rotation: Number(config.rotation),
        u_offsetX: Number(config.offsetX),
        u_offsetY: Number(config.offsetY),
        u_originX: Number(config.originX),
        u_originY: Number(config.originY),
        u_worldWidth: 0,
        u_worldHeight: 0,
      }) satisfies SimplexNoiseUniforms,
  );
