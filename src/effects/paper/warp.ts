import { requiredValue } from "../runtime/required-value";
// Adapted from Paper Shaders 0.0.80, Apache-2.0. See THIRD_PARTY_NOTICES.md.
// Official wrapper defaults/prop mappings; Meridian supplies theme colors and lifecycle.
import {
  warpFragmentShader,
  WarpPatterns,
  type WarpUniforms,
  ShaderFitOptions,
} from "@paper-design/shaders";
import { createPaperBackground } from "./adapter";
import type { BackgroundFactory } from "../runtime/contracts";

export const create: BackgroundFactory = (context) =>
  createPaperBackground(
    context,
    "paper-warp",
    warpFragmentShader,
    (config, _palette, colors, noise) =>
      ({
        // Own uniforms
        u_colors: colors,
        u_colorsCount: colors.length,
        u_proportion: Number(config.proportion),
        u_softness: Number(config.softness),
        u_distortion: Number(config.distortion),
        u_swirl: Number(config.swirl),
        u_swirlIterations: Number(config.swirlIterations),
        u_shapeScale: Number(config.shapeScale),
        u_shape: WarpPatterns[config.shape as keyof typeof WarpPatterns],
        u_noiseTexture: requiredValue(noise),

        // Sizing uniforms
        u_scale: Number(config.scale),
        u_rotation: Number(config.rotation),
        u_fit: ShaderFitOptions[config.fit as keyof typeof ShaderFitOptions],
        u_offsetX: Number(config.offsetX),
        u_offsetY: Number(config.offsetY),
        u_originX: Number(config.originX),
        u_originY: Number(config.originY),
        u_worldWidth: 0,
        u_worldHeight: 0,
      }) satisfies WarpUniforms,
  );
