// Meridian — Dither Sky 8-bit atmospheric shader.
// Ported from docs/layout-demos/island/shaders.js.
import { createMeridianQuad } from "./meridian-quad";
import { ISLAND_COMMON_GLSL } from "./meridian-glsl";
import type {
  BackgroundContext,
  BackgroundInstance,
} from "./runtime/contracts";

const ditherSkyFragmentShader = /* glsl */ `
  ${ISLAND_COMMON_GLSL}

  void main() {
    vec2 cell = floor(gl_FragCoord.xy / u_pix);
    vec2 res = floor(u_res / u_pix);
    vec2 uv = (cell + 0.5) / res;
    float asp = res.x / res.y;
    float t = u_time * 0.02;
    float sky = pow(1.0 - uv.y, 1.7) * 0.72 + 0.04;
    vec2 sp = vec2((uv.x - 0.5) * asp, uv.y - 0.20) * vec2(0.9, 1.7);
    float glow = exp(-dot(sp, sp) * 5.0) * 0.55;
    vec2 cp = vec2(uv.x * asp * 2.4 + t * 3.0, uv.y * 5.5);
    float cl = fbm(cp + vec2(0.0, fbm(cp * 0.6 + t)));
    float band = smoothstep(0.0, 0.45, uv.y) * smoothstep(1.0, 0.55, uv.y);
    float s = clamp(sky + glow + smoothstep(0.46, 0.82, cl) * band * 0.34, 0.0, 1.0);
    float levels = 6.0;
    float q = floor(s * (levels - 1.0) + bayer8(cell)) / (levels - 1.0);
    gl_FragColor = vec4(pal(q), clamp(uOpacity, 0.0, 1.0));
  }
`;

export function createDitherSky(
  context: BackgroundContext,
): BackgroundInstance {
  return createMeridianQuad(context, {
    fragment: ditherSkyFragmentShader,
    baseOpacity: 1,
    maxDpr: 1,
    pixelated: true,
    palettes: {
      night: ["#070a1a", "#1d2860", "#6a5aa8", "#f2b49a"],
      day: ["#3f6fb0", "#8bb4dc", "#f1dcc2", "#fff6e6"],
    },
  });
}
