// Meridian — a single accent transmitted through vertically fluted glass.
import { createMeridianQuad } from "./meridian-quad";
import type {
  BackgroundContext,
  BackgroundInstance,
} from "./runtime/contracts";

export const fractalFragmentShader = /* glsl */ `precision highp float;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform vec3 uPaper;
  uniform vec3 uInk;
  uniform vec3 uAccent;
  uniform float uLightTheme;
  uniform float uOpacity;
  varying vec2 vUv;

  void main() {
    // CSS-height units keep the glass cross-section aspect-correct: 48 ribs at 3:2.
    vec2 p = (vUv - 0.5) * uResolution / max(uResolution.y, 1.0);
    p.y = -p.y;
    float drift = sin(uTime * 0.22439948); // 28 seconds
    float breathe = sin(uTime * 0.19039955 + 1.1); // 33 seconds
    float rib = p.x * 32.0 + 0.14 * sin(p.y * 2.4 + uTime * 0.25132741);
    float face = fract(rib);
    // Differentiate the unwrapped phase, not fract's discontinuous seam.
    float aa = max(fwidth(rib), 0.0001);
    float slope = (face * 2.0 - 1.0);
    slope *= 1.35 - 0.35 * slope * slope;
    float seamFade = smoothstep(0.0, aa, face) * (1.0 - smoothstep(1.0 - aa, 1.0, face));
    vec2 transmitted = p;
    transmitted.x += slope * seamFade * (0.45 / 32.0);

    // A broad curved trough separates upper-right and lower-left illumination.
    // Only the transmitted coordinate sees these contours; the glass stays upright.
    float x = transmitted.x - 0.09 * drift;
    float curve = 0.02 + 0.52 * x - 0.34 * x * x + 0.075 * breathe;
    float distanceToTrough = transmitted.y - curve;
    float illumination = smoothstep(0.035, 0.32, abs(distanceToTrough));
    float upperLight = 1.0 - smoothstep(-0.40, 0.05, distanceToTrough);
    float lowerLight = smoothstep(0.10, 0.55, distanceToTrough);
    float shoulder = 1.0 - smoothstep(0.08, 0.42, abs(x + 0.29 + 0.06 * breathe));
    float light = 0.045 + 0.69 * illumination + 0.15 * upperLight + 0.10 * lowerLight;
    light += 0.20 * shoulder * (1.0 - illumination);

    // Asymmetric polished lip, shaded rounded face, and a thin recessed join.
    float lip = 1.0 - smoothstep(0.035 - aa, 0.075 + aa, abs(face - 0.14));
    float joinShade = 1.0 - smoothstep(0.0, 0.055 + aa, min(face, 1.0 - face));
    float faceShade = face * face * (3.0 - 2.0 * face);
    light += (0.085 * lip - 0.14 * faceShade - 0.035 * joinShade) * (0.35 + 0.65 * illumination);
    light = clamp(light, 0.0, 1.0);

    // Paper/ink contribute luminance only: custom theme roles cannot add a second hue.
    vec3 luma = vec3(0.2126, 0.7152, 0.0722);
    float paper = dot(uPaper, luma);
    float ink = dot(uInk, luma);
    float dark = min(paper, ink) * 0.35;
    float pale = max(paper, ink);
    vec3 tint = mix(uAccent, vec3(pale), 0.16 + 0.22 * uLightTheme);
    vec3 color = mix(vec3(dark), tint, light);
    color = mix(color, vec3(pale), smoothstep(0.60, 1.0, light) * 0.30);
    gl_FragColor = vec4(color, uOpacity * 0.85);
  }`;

export function createFractal(context: BackgroundContext): BackgroundInstance {
  return createMeridianQuad(context, {
    fragment: fractalFragmentShader,
    baseOpacity: 0.5,
    maxDpr: 1.5,
    staticTime: 0,
  });
}
