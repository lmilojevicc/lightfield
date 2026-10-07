// Adapted from Paper Shaders 0.0.80, Apache-2.0. See THIRD_PARTY_NOTICES.md.
// Official wrapper defaults/prop mappings; Meridian supplies theme colors and lifecycle.
import {
  staticRadialGradientFragmentShader,
  type StaticRadialGradientUniforms,
  ShaderFitOptions,
  getShaderColorFromString,
} from "@paper-design/shaders";
import { createPaperBackground } from "./adapter";
import { radialSizingAnimation } from "./radial-motion";
import type { BackgroundFactory } from "../runtime/contracts";

export const create: BackgroundFactory = (context) =>
  createPaperBackground(
    context,
    "paper-static-radial-gradient",
    staticRadialGradientFragmentShader,
    (config, palette, colors) =>
      ({
        // Own uniforms
        u_colorBack: getShaderColorFromString(palette.paperHex),
        u_colors: colors,
        u_colorsCount: colors.length,
        u_radius: Number(config.radius),
        u_focalDistance: Number(config.focalDistance),
        u_focalAngle: Number(config.focalAngle),
        u_falloff: Number(config.falloff),
        u_mixing: Number(config.mixing),
        u_distortion: Number(config.distortion),
        u_distortionShift: Number(config.distortionShift),
        u_distortionFreq: Number(config.distortionFreq),
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
      }) satisfies StaticRadialGradientUniforms,
    radialSizingAnimation,
  );
