// Meridian classic effect: Ripple — concentric ring grid.
// Ported from the pre-9a2092a src/scene.ts monolith.
import { createMeridianQuad } from "./meridian-quad";
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

  void main() {
    vec2 grid = vec2(120.0 * uAspect, 90.0);
    vec2 cell = floor(vUv * grid);
    vec2 cellUv = (cell + 0.5) / grid;
    vec2 uv = (cellUv - 0.5) * vec2(uAspect, 1.0);

    vec2 mousePos = uPointer * vec2(0.5 * uAspect, 0.5);
    float dMouse = length(uv - mousePos);
    float dCenter = length(uv);

    float rings1 = 0.5 + 0.5 * sin(dCenter * 24.0 - uTime * 0.9);
    rings1 = smoothstep(0.82, 0.97, rings1) * exp(-dCenter * 2.0);

    float rings2 = 0.5 + 0.5 * sin(dMouse * 28.0 - uTime * 2.4);
    rings2 = smoothstep(0.80, 0.96, rings2) * exp(-dMouse * 2.5);

    float h = max(rings1, rings2 * 0.85);

    vec3 col = mix(uMuted * 0.6, uAccent, smoothstep(0.1, 0.5, h));
    col = mix(col, uInk, smoothstep(0.6, 0.9, h));

    vec2 g = fract(vUv * grid) - 0.5;
    float cellD = length(g);
    float r = h * 0.36;
    float dot_ = 1.0 - smoothstep(r, r + 0.08, cellD);

    gl_FragColor = vec4(col, dot_ * uOpacity * 0.75);
  }`;

export function createRipple(context: BackgroundContext): BackgroundInstance {
  return createMeridianQuad(context, { fragment, baseOpacity: 0.42 });
}
