// Meridian — Julia fractal shader.
// Ported from docs/layout-demos/island/shaders.js.
import { createMeridianQuad } from "./meridian-quad";
import { ISLAND_COMMON_GLSL } from "./meridian-glsl";
import type {
  BackgroundContext,
  BackgroundInstance,
} from "./runtime/contracts";

export const juliaFragmentShader = /* glsl */ `
  ${ISLAND_COMMON_GLSL}

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
    float a = u_time * 0.035;
    vec2 c = vec2(-0.79 + 0.05 * cos(a * 2.0), 0.15 + 0.06 * sin(a * 3.1));
    float zoom = 1.6 + 0.12 * sin(a * 1.7);
    float ca = cos(a * 0.6), sa = sin(a * 0.6);
    vec2 z = mat2(ca, -sa, sa, ca) * (uv * zoom + (u_mouse - 0.5) * 0.12);
    float trap = 1e4, n = 0.0;
    bool escaped = false;
    for (int i = 0; i < 72; i++) {
      z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
      float d = dot(z, z);
      trap = min(trap, abs(length(z) - 0.85));
      if (d > 64.0) { n = float(i) - log2(log2(d)) + 4.0; escaped = true; break; }
    }
    float v = escaped ? 0.10 + 0.90 * (1.0 - exp(-n * 0.085))
                      : 0.06 + 0.40 * exp(-3.2 * trap);
    vec3 col = pal(v);
    col = mix(col, u_c0, smoothstep(0.7, 1.5, length(uv)) * 0.5);
    col += (hash21(gl_FragCoord.xy) - 0.5) / 255.0;
    gl_FragColor = vec4(col, clamp(uOpacity, 0.0, 1.0));
  }
`;

export function createJulia(context: BackgroundContext): BackgroundInstance {
  return createMeridianQuad(context, {
    fragment: juliaFragmentShader,
    baseOpacity: 0.7,
    maxDpr: 1.5,
    pointerTracking: true,
    palettes: {
      night: ["#05060a", "#0f2a3d", "#2f7a8c", "#e9f4e1"],
      day: ["#f6f2ea", "#d9e4e0", "#8fb4b8", "#2c4a5a"],
    },
  });
}
