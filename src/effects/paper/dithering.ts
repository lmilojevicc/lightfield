// Adapted from Paper Shaders 0.0.80, Apache-2.0. See THIRD_PARTY_NOTICES.md.
// Official wrapper defaults/prop mappings; Meridian supplies theme colors and lifecycle.
import {
  ditheringFragmentShader,
  DitheringShapes,
  DitheringTypes,
  type DitheringUniforms,
  ShaderFitOptions,
  getShaderColorFromString,
} from "@paper-design/shaders";
import { createPaperBackground } from "./adapter";
import type { BackgroundFactory } from "../runtime/contracts";

export const create: BackgroundFactory = (context) =>
  createPaperBackground(
    context,
    "paper-dithering",
    ditheringFragmentShader,
    (config, palette) =>
      ({
        // Own uniforms
        u_colorBack: getShaderColorFromString(palette.paperHex),
        u_colorFront: getShaderColorFromString(palette.inkHex),
        u_shape: DitheringShapes[config.shape as keyof typeof DitheringShapes],
        u_type: DitheringTypes[config.type as keyof typeof DitheringTypes],
        u_pxSize: Number(config.size),

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
      }) satisfies DitheringUniforms,
  );
