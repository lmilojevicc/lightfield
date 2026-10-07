// Meridian classic effect: Smoke — domain-warped volumetric smoke.
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
    float t = uTime * 0.045;
    vec2 mouseOffset = uPointer * 0.08;

    vec2 q = vec2(
      fbm(uv * 1.7 + mouseOffset + t),
      fbm(uv * 1.7 - mouseOffset - t + vec2(3.1, 8.4))
    );
    vec2 r = vec2(
      fbm(uv * 1.7 + 3.2 * q + vec2(1.7, 9.2) + t * 0.6),
      fbm(uv * 1.7 + 3.2 * q + vec2(8.3, 2.8) - t * 0.5)
    );
    float f = fbm(uv * 1.7 + 3.2 * r);
    float bent = fbm(uv * 1.7 + vec2(f, -f) * 0.8 + 3.2 * r * 0.4);

    vec3 col = mix(uMuted * 0.25, uAccent * 0.35, smoothstep(-0.9, 0.7, uv.y + uv.x * 0.4) * 0.3);
    float crest = smoothstep(0.48, 0.88, f + bent * 0.4);
    col += uMuted * crest * 0.3;
    col += uAccent * smoothstep(0.72, 0.98, crest) * 0.35;
    col += uInk * pow(crest, 3.2) * 0.25;

    float grain = hash(vUv * vec2(1600.0, 900.0) + fract(uTime) * 47.3);
    col += (grain - 0.5) * 0.03;

    float vig = smoothstep(1.25, 0.25, length(uv));
    gl_FragColor = vec4(col * vig, uOpacity * 0.55);
  }`;

export function createSmoke(context: BackgroundContext): BackgroundInstance {
  return createMeridianQuad(context, { fragment, baseOpacity: 0.65 });
}
