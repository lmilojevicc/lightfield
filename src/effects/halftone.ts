// Meridian classic effect: Halftone — dot-screen with fBm density.
// Ported from the pre-9a2092a src/scene.ts monolith.
import { createMeridianQuad } from "./meridian-quad";
import { FBM_GLSL } from "./meridian-glsl";
import type {
  BackgroundContext,
  BackgroundInstance,
} from "./runtime/contracts";

const fragment = /* glsl */ `precision highp float;
  uniform float uTime;
  uniform float uAspect;
  uniform vec2 uPointer;
  uniform vec3 uInk;
  uniform vec3 uAccent;
  uniform vec3 uMuted;
  uniform float uOpacity;
  varying vec2 vUv;
  ${FBM_GLSL}
  void main() {
    vec2 uv = (vUv - 0.5) * vec2(uAspect, 1.0);
    float density = 68.0;
    vec2 gv = fract(vUv * vec2(density * uAspect, density)) - 0.5;
    float d = length(gv);
    float h = fbm(uv * 2.2 + uPointer * 0.12 + uTime * 0.035);
    h = smoothstep(0.48, 0.88, h);
    float r = h * 0.34;
    float dot_ = 1.0 - smoothstep(r, r + 0.06, d);
    float vig = smoothstep(1.25, 0.25, length(uv));
    vec3 col = mix(uMuted * 0.5, uAccent, smoothstep(0.4, 0.8, h));
    col = mix(col, uInk, smoothstep(0.7, 0.95, h));
    gl_FragColor = vec4(col, dot_ * vig * uOpacity * 0.75);
  }`;

export function createHalftone(context: BackgroundContext): BackgroundInstance {
  return createMeridianQuad(context, { fragment, baseOpacity: 0.4 });
}
