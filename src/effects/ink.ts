// Meridian — Ink fluid simulation.
// Ported from docs/layout-demos/island/shaders.js.
import { createMeridianQuad } from "./meridian-quad";
import { ISLAND_COMMON_GLSL } from "./meridian-glsl";
import type {
  BackgroundContext,
  BackgroundInstance,
} from "./runtime/contracts";

export const inkFragmentShader = /* glsl */ `
  ${ISLAND_COMMON_GLSL}

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
    float t = u_time * 0.045;
    vec2 p = uv * 1.5 + (u_mouse - 0.5) * 0.25;
    vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - vec2(t, 0.0)));
    vec2 r = vec2(fbm(p + 2.6 * q + vec2(1.7, 9.2) + 0.7 * t),
                  fbm(p + 2.6 * q + vec2(8.3, 2.8) - 0.5 * t));
    float f = fbm(p + 2.6 * r);
    float v = smoothstep(0.10, 0.95, f * 1.25 + 0.35 * length(r) - 0.12);
    vec3 col = pal(pow(v, 1.3));
    col = mix(col, u_c0, smoothstep(0.55, 1.45, length(uv)) * 0.6);
    col += (hash21(gl_FragCoord.xy) - 0.5) / 255.0;
    gl_FragColor = vec4(col, clamp(uOpacity, 0.0, 1.0));
  }
`;

export function createInk(context: BackgroundContext): BackgroundInstance {
  return createMeridianQuad(context, {
    fragment: inkFragmentShader,
    baseOpacity: 0.6,
    maxDpr: 1.5,
    pointerTracking: true,
    palettes: {
      night: ["#04050b", "#141a3d", "#4a3a86", "#e0a3a0"],
      day: ["#f4efe6", "#e2d4c6", "#b9a8d2", "#6d86c0"],
    },
  });
}
