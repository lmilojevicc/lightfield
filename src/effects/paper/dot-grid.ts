// Adapted from Paper Shaders 0.0.80, Apache-2.0. See THIRD_PARTY_NOTICES.md.
// Official wrapper defaults/prop mappings; Meridian supplies theme colors and lifecycle.
import {
  dotGridFragmentShader,
  DotGridShapes,
  type DotGridUniforms,
  ShaderFitOptions,
  getShaderColorFromString,
} from "@paper-design/shaders";
import { createPaperBackground } from "./adapter";
import type { BackgroundFactory } from "../runtime/contracts";

export const create: BackgroundFactory = (context) =>
  createPaperBackground(
    context,
    "paper-dot-grid",
    dotGridFragmentShader,
    (config, palette) =>
      ({
        // Own uniforms
        u_colorBack: getShaderColorFromString(palette.paperHex),
        u_colorFill: getShaderColorFromString(palette.inkHex),
        u_colorStroke: getShaderColorFromString(palette.accentHex),
        u_dotSize: Number(config.size),
        u_gapX: Number(config.gapX),
        u_gapY: Number(config.gapY),
        u_strokeWidth: Number(config.strokeWidth),
        u_sizeRange: Number(config.sizeRange),
        u_opacityRange: Number(config.opacityRange),
        u_shape: DotGridShapes[config.shape as keyof typeof DotGridShapes],

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
      }) satisfies DotGridUniforms,
  );
