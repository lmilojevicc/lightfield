// Meridian classic effect: Topo — topographic contour lines.
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
    float t = uTime * 0.025;
    vec2 mouseOffset = uPointer * 0.08;
    vec2 q = vec2(
      fbm(uv * 2.2 + mouseOffset + t),
      fbm(uv * 2.2 - mouseOffset + vec2(5.2, 1.3) - t * 0.7)
    );
    float h = fbm(uv * 2.2 + q * 1.4 + t * 0.3);
    float levels = 18.0;
    float c = abs(fract(h * levels) - 0.5);
    float line = 1.0 - smoothstep(0.0, 0.06, c);
    float major = step(0.65, fract(h * levels / 5.0));
    vec3 col = mix(uMuted * 0.6, uInk, line);
    col = mix(col, uAccent, major * line * 0.75);
    float vig = smoothstep(1.3, 0.3, length(uv));
    gl_FragColor = vec4(col, line * vig * uOpacity * 0.85);
  }`;

export function createTopo(context: BackgroundContext): BackgroundInstance {
  return createMeridianQuad(context, { fragment, baseOpacity: 0.35 });
}
