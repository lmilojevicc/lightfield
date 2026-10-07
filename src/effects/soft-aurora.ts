import { requiredValue } from "./runtime/required-value";
// Adapted from React Bits SoftAurora.jsx at c7109dccb42e06592d1d9bc50bc87204697240e2.
// Copyright (c) 2026 David Haz. MIT + Commons Clause License Condition v1.0.
import { Renderer, Program, Mesh, Triangle } from "ogl";
import type {
  BackgroundContext,
  BackgroundInstance,
  BackgroundUpdateContext,
} from "./runtime/contracts";
const vertexShader = `
attribute vec2 uv;
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0, 1);
}
`;
const fragmentShader = `
precision highp float;

uniform float uTime;
uniform vec3 uResolution;
uniform float uSpeed;
uniform float uScale;
uniform float uBrightness;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform float uNoiseFreq;
uniform float uNoiseAmp;
uniform float uBandHeight;
uniform float uBandSpread;
uniform float uOctaveDecay;
uniform float uLayerOffset;
uniform float uColorSpeed;
uniform vec2 uMouse;
uniform float uMouseInfluence;
uniform bool uEnableMouse;

#define TAU 6.28318

vec3 gradientHash(vec3 p) {
  p = vec3(
    dot(p, vec3(127.1, 311.7, 234.6)),
    dot(p, vec3(269.5, 183.3, 198.3)),
    dot(p, vec3(169.5, 283.3, 156.9))
  );
  vec3 h = fract(sin(p) * 43758.5453123);
  float phi = acos(2.0 * h.x - 1.0);
  float theta = TAU * h.y;
  return vec3(cos(theta) * sin(phi), sin(theta) * cos(phi), cos(phi));
}

float quinticSmooth(float t) {
  float t2 = t * t;
  float t3 = t * t2;
  return 6.0 * t3 * t2 - 15.0 * t2 * t2 + 10.0 * t3;
}

vec3 cosineGradient(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(TAU * (c * t + d));
}

float perlin3D(float amplitude, float frequency, float px, float py, float pz) {
  float x = px * frequency;
  float y = py * frequency;

  float fx = floor(x); float fy = floor(y); float fz = floor(pz);
  float cx = ceil(x);  float cy = ceil(y);  float cz = ceil(pz);

  vec3 g000 = gradientHash(vec3(fx, fy, fz));
  vec3 g100 = gradientHash(vec3(cx, fy, fz));
  vec3 g010 = gradientHash(vec3(fx, cy, fz));
  vec3 g110 = gradientHash(vec3(cx, cy, fz));
  vec3 g001 = gradientHash(vec3(fx, fy, cz));
  vec3 g101 = gradientHash(vec3(cx, fy, cz));
  vec3 g011 = gradientHash(vec3(fx, cy, cz));
  vec3 g111 = gradientHash(vec3(cx, cy, cz));

  float d000 = dot(g000, vec3(x - fx, y - fy, pz - fz));
  float d100 = dot(g100, vec3(x - cx, y - fy, pz - fz));
  float d010 = dot(g010, vec3(x - fx, y - cy, pz - fz));
  float d110 = dot(g110, vec3(x - cx, y - cy, pz - fz));
  float d001 = dot(g001, vec3(x - fx, y - fy, pz - cz));
  float d101 = dot(g101, vec3(x - cx, y - fy, pz - cz));
  float d011 = dot(g011, vec3(x - fx, y - cy, pz - cz));
  float d111 = dot(g111, vec3(x - cx, y - cy, pz - cz));

  float sx = quinticSmooth(x - fx);
  float sy = quinticSmooth(y - fy);
  float sz = quinticSmooth(pz - fz);

  float lx00 = mix(d000, d100, sx);
  float lx10 = mix(d010, d110, sx);
  float lx01 = mix(d001, d101, sx);
  float lx11 = mix(d011, d111, sx);

  float ly0 = mix(lx00, lx10, sy);
  float ly1 = mix(lx01, lx11, sy);

  return amplitude * mix(ly0, ly1, sz);
}

float auroraGlow(float t, vec2 shift) {
  vec2 uv = gl_FragCoord.xy / uResolution.y;
  uv += shift;

  float noiseVal = 0.0;
  float freq = uNoiseFreq;
  float amp = uNoiseAmp;
  vec2 samplePos = uv * uScale;

  for (float i = 0.0; i < 3.0; i += 1.0) {
    noiseVal += perlin3D(amp, freq, samplePos.x, samplePos.y, t);
    amp *= uOctaveDecay;
    freq *= 2.0;
  }

  float yBand = uv.y * 10.0 - uBandHeight * 10.0;
  return 0.3 * max(exp(uBandSpread * (1.0 - 1.1 * abs(noiseVal + yBand))), 0.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution.xy;
  float t = uSpeed * 0.4 * uTime;

  vec2 shift = vec2(0.0);
  if (uEnableMouse) {
    shift = (uMouse - 0.5) * uMouseInfluence;
  }

  vec3 col = vec3(0.0);
  col += 0.99 * auroraGlow(t, shift) * cosineGradient(uv.x + uTime * uSpeed * 0.2 * uColorSpeed, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.3, 0.20, 0.20)) * uColor1;
  col += 0.99 * auroraGlow(t + uLayerOffset, shift) * cosineGradient(uv.x + uTime * uSpeed * 0.1 * uColorSpeed, vec3(0.5), vec3(0.5), vec3(2.0, 1.0, 0.0), vec3(0.5, 0.20, 0.25)) * uColor2;

  col *= uBrightness;
  float alpha = clamp(length(col), 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;
export function createSoftAurora(
  context: BackgroundContext,
): BackgroundInstance {
  const renderer = new Renderer({
    alpha: true,
    premultipliedAlpha: false,
    dpr: 1,
  });
  const gl = renderer.gl,
    canvas = gl.canvas;
  canvas.className = "background-canvas";
  gl.clearColor(0, 0, 0, 0);
  context.host.replaceChildren(canvas);
  const geometry = new Triangle(gl);
  const uniforms = {
    uTime: { value: 0 },
    uResolution: { value: [1, 1, 1] },
    uSpeed: { value: 0.6 },
    uScale: { value: 1.5 },
    uBrightness: { value: 1 },
    uColor1: { value: context.palette.ink },
    uColor2: { value: context.palette.accent },
    uNoiseFreq: { value: 2.5 },
    uNoiseAmp: { value: 1 },
    uBandHeight: { value: 0.5 },
    uBandSpread: { value: 1 },
    uOctaveDecay: { value: 0.1 },
    uLayerOffset: { value: 0 },
    uColorSpeed: { value: 1 },
    uMouse: { value: new Float32Array([0.5, 0.5]) },
    uMouseInfluence: { value: 0.25 },
    uEnableMouse: { value: true },
  };
  const program = new Program(gl, {
    vertex: vertexShader,
    fragment: fragmentShader,
    uniforms,
  });
  const mesh = new Mesh(gl, { geometry, program });
  let frame = 0,
    destroyed = false,
    failed = false,
    visible = context.visible,
    reduced = context.reducedMotion,
    lastTime = 0,
    current = [0.5, 0.5],
    target = [0.5, 0.5],
    interaction = true;
  function fail(error?: unknown) {
    if (failed || destroyed) return;
    failed = true;
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    context.reportRuntimeFailure(error);
  }
  function resize() {
    renderer.dpr = 1;
    renderer.setSize(context.host.clientWidth, context.host.clientHeight);
    uniforms.uResolution.value = [
      canvas.width,
      canvas.height,
      canvas.width / Math.max(canvas.height, 1),
    ];
    ensure();
  }
  function move(e: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    if (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom ||
      rect.width === 0 ||
      rect.height === 0
    ) {
      target = [0.5, 0.5];
      ensure();
      return;
    }
    target = [
      (e.clientX - rect.left) / rect.width,
      1 - (e.clientY - rect.top) / rect.height,
    ];
    ensure();
  }
  function contextLost() {
    fail(new Error("Soft Aurora WebGL context was lost"));
  }
  window.addEventListener("pointermove", move, { passive: true });
  canvas.addEventListener("webglcontextlost", contextLost);
  function draw(time: number) {
    frame = 0;
    if (destroyed || failed || !visible) return;
    lastTime = reduced ? lastTime : time * 0.001;
    uniforms.uTime.value = lastTime;
    if (interaction) {
      current[0] =
        requiredValue(current[0]) +
        0.05 * (requiredValue(target[0]) - requiredValue(current[0]));
      current[1] =
        requiredValue(current[1]) +
        0.05 * (requiredValue(target[1]) - requiredValue(current[1]));
    } else current = [0.5, 0.5];
    uniforms.uMouse.value[0] = requiredValue(current[0]);
    uniforms.uMouse.value[1] = requiredValue(current[1]);
    try {
      renderer.render({ scene: mesh });
      context.reportPaint?.();
    } catch (error) {
      fail(error);
      return;
    }
    if (!reduced) frame = requestAnimationFrame(draw);
  }
  function ensure() {
    if (!destroyed && !failed && visible && frame === 0)
      frame = requestAnimationFrame(draw);
  }
  function update(next: BackgroundUpdateContext) {
    visible = next.visible;
    reduced = next.reducedMotion;
    interaction = Boolean(next.config.enableMouseInteraction);
    uniforms.uSpeed.value = Number(next.config.speed);
    uniforms.uScale.value = Number(next.config.scale);
    uniforms.uBrightness.value = Number(next.config.brightness);
    uniforms.uColor1.value = next.palette.ink;
    uniforms.uColor2.value = next.palette.accent;
    uniforms.uNoiseFreq.value = Number(next.config.noiseFrequency);
    uniforms.uNoiseAmp.value = Number(next.config.noiseAmplitude);
    uniforms.uBandHeight.value = Number(next.config.bandHeight);
    uniforms.uBandSpread.value = Number(next.config.bandSpread);
    uniforms.uOctaveDecay.value = Number(next.config.octaveDecay);
    uniforms.uLayerOffset.value = Number(next.config.layerOffset);
    uniforms.uColorSpeed.value = Number(next.config.colorSpeed);
    uniforms.uMouseInfluence.value = Number(next.config.mouseInfluence);
    uniforms.uEnableMouse.value = interaction;
    if (!visible && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    ensure();
  }
  resize();
  update(context);
  return {
    resize,
    update,
    destroy() {
      destroyed = true;
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      canvas.removeEventListener("webglcontextlost", contextLost);
      geometry.remove();
      program.remove();
      canvas.remove();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
