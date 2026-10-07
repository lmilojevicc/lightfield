// Meridian classic effect: Ray — grainy volumetric light ray.
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
    float t = uTime * 0.08;

    vec2 q = vec2(fbm(uv * 1.5 + t * 0.5), fbm(uv * 1.5 - t * 0.4 + vec2(2.8, 5.1)));
    float bgNoise = fbm(uv * 1.2 + q * 1.8);

    vec3 col = mix(uInk * 0.15, uMuted * 0.25, smoothstep(-0.8, 0.8, uv.y + uv.x * 0.3));
    col = mix(col, uAccent * 0.35, bgNoise * 0.6);

    vec2 rayDir = normalize(vec2(1.0 + uPointer.x * 0.2, 0.6 + uPointer.y * 0.2));
    float rayProj = dot(uv, rayDir);
    float rayOrth = dot(uv, vec2(-rayDir.y, rayDir.x));

    float sweep = sin(t * 0.4 + rayOrth * 1.5) * 0.2;
    float rayDist = abs(rayOrth - sweep - sin(rayProj * 3.0 + t * 0.8) * 0.1);

    float ray = exp(-rayDist * rayDist * 12.0);
    float shimmer = fbm(vec2(rayProj * 4.0 - t * 1.2, rayOrth * 8.0));
    ray *= (0.75 + 0.25 * shimmer);

    col += mix(uAccent, uInk, smoothstep(-0.5, 0.5, rayProj)) * ray * 0.55;
    col += uInk * pow(ray, 3.0) * 0.4;

    float grain = hash(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 91.3);
    col += (grain - 0.5) * 0.045;

    float vig = smoothstep(1.3, 0.3, length(uv));
    gl_FragColor = vec4(col * vig, uOpacity * 0.85);
  }`;

export function createRay(context: BackgroundContext): BackgroundInstance {
  return createMeridianQuad(context, { fragment, baseOpacity: 0.5 });
}
