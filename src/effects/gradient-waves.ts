import { requiredValue } from "./runtime/required-value";
// Adapted from React Bits GradientWaves.jsx at c7109dccb42e06592d1d9bc50bc87204697240e2.
// Copyright (c) 2026 David Haz. MIT + Commons Clause License Condition v1.0.
import { Mesh, Program, Renderer, Triangle } from "ogl";
import type {
  BackgroundContext,
  BackgroundInstance,
  BackgroundUpdateContext,
} from "./runtime/contracts";

const vertex = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

// Source-fidelity constraints: the pinned shader adds grain after opacity, and the
// pinned wrapper intentionally retains DPR 2 with no render-scale/FPS controls.
export const gradientWavesFragmentShader = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform float uSpeed;
uniform float uAmplitude;
uniform float uWaveScale;
uniform float uWaveRatio;
uniform float uSwell;
uniform float uTurbulence;
uniform float uTilt;
uniform float uZoom;
uniform float uHeight;
uniform float uFogDepth;
uniform float uSteps;
uniform float uBrightness;
uniform float uOpacity;
uniform float uGrain;
uniform float uGrainIntensity;
uniform vec2 uMouse;
uniform float uParallax;
uniform bool uEnableMouse;
uniform vec3 uHorizonColor;
uniform vec3 uWaveColor;
uniform vec3 uCrestColor;
out vec4 fragColor;

const float MAX_DIST = 20000.0;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float plasma(vec3 r, vec2 freq, vec4 tc) {
  float mx = r.x + tc.x;
  mx += uSwell * sin((r.y + mx) / 20.0 + tc.y);
  float my = r.y - tc.z;
  my += uTurbulence * cos(r.x / 23.0 + tc.w);
  return r.z - (sin(mx * freq.x) * uAmplitude + sin(my * freq.y) * uAmplitude + uHeight);
}

float raymarch(vec3 pos, vec3 dir, vec2 freq, vec4 tc) {
  float dist = 0.0;
  for (int i = 0; i < 128; i++) {
    if (float(i) >= uSteps) break;
    float dscene = plasma(pos + dist * dir, freq, tc);
    if (abs(dscene) < 0.1) break;
    dist += 0.9 * dscene;
    if (!(abs(dist) < MAX_DIST)) return MAX_DIST;
  }
  return dist;
}

void main() {
  float T = iTime * uSpeed;
  vec2 freq = vec2(uWaveScale / 7.0, (uWaveScale * uWaveRatio) / 3.0);
  vec4 tc = vec4(T / 0.130, T / 0.810, T / 0.200, T / 0.710);
  float c, s;
  float vfov = (3.14159 / 2.3) / max(uZoom, 0.05);
  vec3 cam = vec3(0.0, 0.0, 30.0);
  vec2 uv = (gl_FragCoord.xy / iResolution.xy) - 0.5;
  uv.x *= iResolution.x / iResolution.y;
  uv.y *= -1.0;

  vec3 dir = vec3(0.0, 0.0, -1.0);
  float ulen = length(uv);
  float xrot = vfov * ulen;
  c = cos(xrot); s = sin(xrot);
  dir = mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c) * dir;
  vec2 nuv = ulen > 1e-5 ? uv / ulen : vec2(1.0, 0.0);
  c = nuv.x; s = nuv.y;
  dir = mat3(c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0) * dir;
  c = cos(uTilt); s = sin(uTilt);
  dir = mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c) * dir;

  if (uEnableMouse) {
    float yaw = (uMouse.x - 0.5) * uParallax * 0.4;
    float pitch = (uMouse.y - 0.5) * uParallax * 0.4;
    c = cos(yaw); s = sin(yaw);
    dir = mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c) * dir;
    c = cos(pitch); s = sin(pitch);
    dir = mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c) * dir;
  }

  float dist = raymarch(cam, dir, freq, tc);
  vec3 pos = cam + dist * dir;

  float t = clamp(uFogDepth / max(dist, 0.001), 0.0, 1.0);
  vec3 body = mix(uWaveColor, uCrestColor, clamp(pos.z * 0.08 + 0.5, 0.0, 1.0));
  vec3 col = mix(uHorizonColor, body, t);
  col *= uBrightness;
  col = clamp(col, 0.0, 1.0);

  float alpha = clamp(t, 0.0, 1.0) * uOpacity;
  if (uGrain > 0.5) {
    float g = hash21(gl_FragCoord.xy + mod(iTime, 64.0) * 11.0);
    alpha += (g - 0.5) * uGrainIntensity;
  }
  alpha = clamp(alpha, 0.0, 1.0);
  fragColor = vec4(col * alpha, alpha);
}
`;

// Keep the pinned raymarch quality tiers exact despite their potentially high cost.
export function gradientWavesDetailSteps(detail: string): number {
  if (detail === "low") return 40;
  if (detail === "high") return 110;
  return 70;
}

export function shouldAnimateGradientWaves(
  speed: number,
  grain: boolean,
  grainIntensity: number,
  mouseInteraction: boolean,
  reducedMotion: boolean,
  pointerSettled = true,
): boolean {
  return (
    !reducedMotion &&
    (speed !== 0 ||
      (grain && grainIntensity !== 0) ||
      (mouseInteraction && !pointerSettled))
  );
}

export function createGradientWaves(
  context: BackgroundContext,
): BackgroundInstance {
  const renderer = new Renderer({
    webgl: 2,
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    dpr: Math.min(window.devicePixelRatio || 1, 2),
  });
  const gl = renderer.gl;
  const canvas = gl.canvas;
  if (!renderer.isWebgl2) {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    throw new Error(
      "Gradient Waves requires WebGL2 because its pinned renderer and shaders require it",
    );
  }
  canvas.className = "background-canvas";
  gl.clearColor(0, 0, 0, 0);
  const geometry = new Triangle(gl);
  const uniforms = {
    iTime: { value: 0 },
    iResolution: { value: new Float32Array([1, 1]) },
    uSpeed: { value: 0.4 },
    uAmplitude: { value: 2.5 },
    uWaveScale: { value: 0.6 },
    uWaveRatio: { value: 0.9 },
    uSwell: { value: 35 },
    uTurbulence: { value: 20 },
    uTilt: { value: 1.11 },
    uZoom: { value: 1 },
    uHeight: { value: 5.5 },
    uFogDepth: { value: 15 },
    uSteps: { value: 70 },
    uBrightness: { value: 1 },
    uOpacity: { value: 1 },
    uGrain: { value: 1 },
    uGrainIntensity: { value: 0.05 },
    uMouse: { value: new Float32Array([0.5, 0.5]) },
    uParallax: { value: 0.5 },
    uEnableMouse: { value: true },
    // Official semantic order: horizon, body, crest.
    uHorizonColor: { value: new Float32Array(context.palette.accent) },
    uWaveColor: { value: new Float32Array(context.palette.focus) },
    uCrestColor: { value: new Float32Array(context.palette.ink) },
  };
  const program = new Program(gl, {
    vertex,
    fragment: gradientWavesFragmentShader,
    uniforms,
  });
  if (!gl.getProgramParameter(program.program, gl.LINK_STATUS)) {
    const detail =
      gl.getProgramInfoLog(program.program) || "unknown link error";
    geometry.remove();
    program.remove();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    throw new Error(`Gradient Waves shader program failed to link: ${detail}`);
  }
  const mesh = new Mesh(gl, { geometry, program });
  context.host.replaceChildren(canvas);

  let frame = 0;
  let destroyed = false;
  let failed = false;
  let visible = context.visible;
  let reducedMotion = context.reducedMotion;
  let speed = 0.4;
  let grain = true;
  let grainIntensity = 0.05;
  let mouseInteraction = true;
  let lastTime = 0;
  const startedAt = performance.now();
  let sizedWidth = -1;
  let sizedHeight = -1;
  let sizedDpr = -1;
  const currentMouse = new Float32Array([0.5, 0.5]);
  const targetMouse = new Float32Array([0.5, 0.5]);

  function fail(error?: unknown) {
    if (destroyed || failed) return;
    failed = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    context.reportRuntimeFailure(error);
  }
  function contextLost(event: Event) {
    event.preventDefault();
    fail(new Error("Gradient Waves WebGL context was lost"));
  }
  canvas.addEventListener("webglcontextlost", contextLost);

  function resetPointer() {
    if (!mouseInteraction) return;
    targetMouse[0] = 0.5;
    targetMouse[1] = 0.5;
    ensureFrame();
  }
  function pointerMove(event: PointerEvent) {
    if (!mouseInteraction) return;
    const rect = canvas.getBoundingClientRect();
    if (
      rect.width === 0 ||
      rect.height === 0 ||
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    ) {
      resetPointer();
      return;
    }
    targetMouse[0] = (event.clientX - rect.left) / rect.width;
    targetMouse[1] = 1 - (event.clientY - rect.top) / rect.height;
    ensureFrame();
  }
  window.addEventListener("pointermove", pointerMove, { passive: true });
  window.addEventListener("pointerleave", resetPointer);

  function pointerIsSettled(): boolean {
    const tx = mouseInteraction ? requiredValue(targetMouse[0]) : 0.5;
    const ty = mouseInteraction ? requiredValue(targetMouse[1]) : 0.5;
    return (
      Math.abs(tx - requiredValue(currentMouse[0])) < 1e-5 &&
      Math.abs(ty - requiredValue(currentMouse[1])) < 1e-5
    );
  }
  function draw(time: number) {
    frame = 0;
    if (destroyed || failed || !visible) return;
    if (!reducedMotion) lastTime = (time - startedAt) * 0.001;
    uniforms.iTime.value = lastTime;
    const tx = mouseInteraction ? requiredValue(targetMouse[0]) : 0.5;
    const ty = mouseInteraction ? requiredValue(targetMouse[1]) : 0.5;
    currentMouse[0] =
      requiredValue(currentMouse[0]) +
      0.05 * (tx - requiredValue(currentMouse[0]));
    currentMouse[1] =
      requiredValue(currentMouse[1]) +
      0.05 * (ty - requiredValue(currentMouse[1]));
    uniforms.uMouse.value.set(currentMouse);
    try {
      renderer.render({ scene: mesh });
      context.reportPaint?.();
    } catch (error) {
      fail(error);
      return;
    }
    if (
      shouldAnimateGradientWaves(
        speed,
        grain,
        grainIntensity,
        mouseInteraction,
        reducedMotion,
        pointerIsSettled(),
      )
    ) {
      frame = requestAnimationFrame(draw);
    }
  }
  function ensureFrame() {
    if (!destroyed && !failed && visible && frame === 0)
      frame = requestAnimationFrame(draw);
  }
  function resize() {
    const rect = context.host.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (width !== sizedWidth || height !== sizedHeight || dpr !== sizedDpr) {
      sizedWidth = width;
      sizedHeight = height;
      sizedDpr = dpr;
      renderer.dpr = dpr;
      renderer.setSize(width, height);
      uniforms.iResolution.value[0] = gl.drawingBufferWidth;
      uniforms.iResolution.value[1] = gl.drawingBufferHeight;
    }
    ensureFrame();
  }
  function update(next: BackgroundUpdateContext) {
    visible = next.visible;
    reducedMotion = next.reducedMotion;
    const config = next.config;
    speed = Number(config.speed);
    grain = Boolean(config.grain);
    grainIntensity = Number(config.grainIntensity);
    mouseInteraction = Boolean(config.mouseInteraction);
    uniforms.uSpeed.value = speed;
    uniforms.uAmplitude.value = Number(config.amplitude);
    uniforms.uWaveScale.value = Number(config.waveScale);
    uniforms.uWaveRatio.value = Number(config.waveRatio);
    uniforms.uSwell.value = Number(config.swell);
    uniforms.uTurbulence.value = Number(config.turbulence);
    uniforms.uTilt.value = Number(config.tilt);
    uniforms.uZoom.value = Number(config.zoom);
    uniforms.uHeight.value = Number(config.height);
    uniforms.uFogDepth.value = Number(config.fogDepth);
    uniforms.uSteps.value = gradientWavesDetailSteps(String(config.detail));
    uniforms.uBrightness.value = Number(config.brightness);
    uniforms.uOpacity.value = Number(config.opacity);
    uniforms.uGrain.value = grain ? 1 : 0;
    uniforms.uGrainIntensity.value = grainIntensity;
    uniforms.uParallax.value = Number(config.parallaxStrength);
    uniforms.uEnableMouse.value = mouseInteraction;
    uniforms.uHorizonColor.value.set(next.palette.accent);
    uniforms.uWaveColor.value.set(next.palette.focus);
    uniforms.uCrestColor.value.set(next.palette.ink);
    if (!visible && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    ensureFrame();
  }

  update(context);
  resize();
  return {
    update,
    resize,
    destroy() {
      destroyed = true;
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", pointerMove);
      window.removeEventListener("pointerleave", resetPointer);
      canvas.removeEventListener("webglcontextlost", contextLost);
      geometry.remove();
      program.remove();
      canvas.remove();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
