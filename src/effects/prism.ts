// Adapted from React Bits Prism.jsx at c7109dccb42e06592d1d9bc50bc87204697240e2.
// Copyright (c) 2026 David Haz. MIT + Commons Clause License Condition v1.0.
import { Mesh, Program, Renderer, Triangle } from "ogl";
import {
  sanitizeRgb01,
  shouldResizeOglBacking,
  type OglBackingSize,
} from "./ogl-math";
import type {
  BackgroundContext,
  BackgroundInstance,
  BackgroundUpdateContext,
} from "./runtime/contracts";

const vertex = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const prismFragmentShader = `
precision highp float;
uniform vec2  iResolution;
uniform float iTime;
uniform float uHeight;
uniform float uBaseHalf;
uniform mat3  uRot;
uniform int   uUseBaseWobble;
uniform float uGlow;
uniform vec2  uOffsetPx;
uniform float uNoise;
uniform float uSaturation;
uniform float uScale;
uniform float uHueShift;
uniform float uColorFreq;
uniform float uBloom;
uniform float uCenterShift;
uniform float uInvBaseHalf;
uniform float uInvHeight;
uniform float uMinAxis;
uniform float uPxScale;
uniform float uTimeScale;
uniform vec3  uPaletteColor;

vec4 tanh4(vec4 x){
  // Exact pinned implementation. Upstream can produce Inf/Inf beyond the
  // exponential overflow region; retain that source behavior deliberately.
  vec4 e2x = exp(2.0*x);
  return (e2x - 1.0) / (e2x + 1.0);
}
float rand(vec2 co){
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453123);
}
float sdOctaAnisoInv(vec3 p){
  vec3 q = vec3(abs(p.x) * uInvBaseHalf, abs(p.y) * uInvHeight, abs(p.z) * uInvBaseHalf);
  float m = q.x + q.y + q.z - 1.0;
  return m * uMinAxis * 0.5773502691896258;
}
float sdPyramidUpInv(vec3 p){
  float oct = sdOctaAnisoInv(p);
  float halfSpace = -p.y;
  return max(oct, halfSpace);
}
mat3 hueRotation(float a){
  float c = cos(a), s = sin(a);
  mat3 W = mat3(
    0.299, 0.587, 0.114,
    0.299, 0.587, 0.114,
    0.299, 0.587, 0.114
  );
  mat3 U = mat3(
     0.701, -0.587, -0.114,
    -0.299,  0.413, -0.114,
    -0.300, -0.588,  0.886
  );
  mat3 V = mat3(
     0.168, -0.331,  0.500,
     0.328,  0.035, -0.500,
    -0.497,  0.296,  0.201
  );
  return W + U * c + V * s;
}

void main(){
  vec2 f = (gl_FragCoord.xy - 0.5 * iResolution.xy - uOffsetPx) * uPxScale;
  float z = 5.0;
  float d = 0.0;
  vec3 p;
  vec4 o = vec4(0.0);
  float centerShift = uCenterShift;
  float cf = uColorFreq;
  mat2 wob = mat2(1.0);
  if (uUseBaseWobble == 1) {
    float t = iTime * uTimeScale;
    float c0 = cos(t + 0.0);
    float c1 = cos(t + 33.0);
    float c2 = cos(t + 11.0);
    wob = mat2(c0, c1, c2, c0);
  }
  const int STEPS = 100;
  for (int i = 0; i < STEPS; i++) {
    p = vec3(f, z);
    p.xz = p.xz * wob;
    p = uRot * p;
    vec3 q = p;
    q.y += centerShift;
    d = 0.1 + 0.2 * abs(sdPyramidUpInv(q));
    z -= d;
    o += (sin((p.y + z) * cf + vec4(0.0, 1.0, 2.0, 3.0)) + 1.0) / d;
  }
  o = tanh4(o * o * (uGlow * uBloom) / 1e5);
  vec3 col = o.rgb;
  float n = rand(gl_FragCoord.xy + vec2(iTime));
  col += (n - 0.5) * uNoise;
  col = clamp(col, 0.0, 1.0);
  float L = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = clamp(mix(vec3(L), col, uSaturation), 0.0, 1.0);
  if(abs(uHueShift) > 0.0001){
    col = clamp(hueRotation(uHueShift) * col, 0.0, 1.0);
  }

  // Meridian color-only deviation: sanitize, theme-modulate, then retain as
  // much chroma as the RGB gamut permits without changing displayed luminance.
  vec3 source = vec3(
    (col.r - col.r) == 0.0 ? col.r : 0.0,
    (col.g - col.g) == 0.0 ? col.g : 0.0,
    (col.b - col.b) == 0.0 ? col.b : 0.0
  );
  vec3 tint = vec3(
    (uPaletteColor.r - uPaletteColor.r) == 0.0 ? uPaletteColor.r : 0.0,
    (uPaletteColor.g - uPaletteColor.g) == 0.0 ? uPaletteColor.g : 0.0,
    (uPaletteColor.b - uPaletteColor.b) == 0.0 ? uPaletteColor.b : 0.0
  );
  source = clamp(source, 0.0, 1.0);
  tint = clamp(tint, 0.0, 1.0);
  float sourceLum = clamp(dot(source, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
  vec3 tinted = source * tint;
  float tintedLum = clamp(dot(tinted, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
  if (sourceLum <= 0.0) {
    col = vec3(0.0);
  } else if (tintedLum <= 0.0) {
    col = vec3(sourceLum);
  } else {
    vec3 scaled = tinted * (sourceLum / tintedLum);
    vec3 delta = scaled - vec3(sourceLum);
    float gamutFactor = 1.0;
    if (delta.r > 0.0) gamutFactor = min(gamutFactor, (1.0 - sourceLum) / delta.r);
    else if (delta.r < 0.0) gamutFactor = min(gamutFactor, -sourceLum / delta.r);
    if (delta.g > 0.0) gamutFactor = min(gamutFactor, (1.0 - sourceLum) / delta.g);
    else if (delta.g < 0.0) gamutFactor = min(gamutFactor, -sourceLum / delta.g);
    if (delta.b > 0.0) gamutFactor = min(gamutFactor, (1.0 - sourceLum) / delta.b);
    else if (delta.b < 0.0) gamutFactor = min(gamutFactor, -sourceLum / delta.b);
    col = vec3(sourceLum) + delta * max(gamutFactor, 0.0);
  }
  gl_FragColor = vec4(col, o.a);
}`;

export const PRISM_INITIAL_POINTER = { x: 0, y: 0, inside: true } as const;
export const PRISM_INITIAL_EULER = [0, 0, 0] as const;
export const PRISM_INITIAL_ROTATION = [1, 0, 0, 0, 1, 0, 0, 0, 1] as const;

export function shouldResetPrismAnimationState(
  previous: string,
  next: string,
): boolean {
  return previous !== next;
}

function setMat3FromEuler(
  yaw: number,
  pitch: number,
  roll: number,
  out: Float32Array,
) {
  const cy = Math.cos(yaw),
    sy = Math.sin(yaw);
  const cx = Math.cos(pitch),
    sx = Math.sin(pitch);
  const cz = Math.cos(roll),
    sz = Math.sin(roll);
  out[0] = cy * cz + sy * sx * sz;
  out[1] = cx * sz;
  out[2] = -sy * cz + cy * sx * sz;
  out[3] = -cy * sz + sy * sx * cz;
  out[4] = cx * cz;
  out[5] = sy * sz + cy * sx * cz;
  out[6] = sy * cx;
  out[7] = -sx;
  out[8] = cy * cx;
}

export function createPrism(context: BackgroundContext): BackgroundInstance {
  // Resolution only: the pinned 100-step integrator is deliberately unchanged.
  const dpr = Math.min(1.5, window.devicePixelRatio || 1);
  const renderer = new Renderer({ dpr, alpha: true, antialias: false });
  const gl = renderer.gl;
  const canvas = gl.canvas;
  canvas.className = "background-canvas";
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.BLEND);

  const iResolution = new Float32Array(2);
  const offsetPx = new Float32Array(2);
  const rotation = new Float32Array(PRISM_INITIAL_ROTATION);
  const uniforms = {
    iResolution: { value: iResolution },
    iTime: { value: 0 },
    uHeight: { value: 3.5 },
    uBaseHalf: { value: 2.75 },
    uUseBaseWobble: { value: 1 },
    uRot: { value: rotation },
    uGlow: { value: 1 },
    uOffsetPx: { value: offsetPx },
    uNoise: { value: 0 },
    uSaturation: { value: 1.5 },
    uScale: { value: 3.6 },
    uHueShift: { value: 0 },
    uColorFreq: { value: 1 },
    uBloom: { value: 1 },
    uCenterShift: { value: 0.875 },
    uInvBaseHalf: { value: 1 / 2.75 },
    uInvHeight: { value: 1 / 3.5 },
    uMinAxis: { value: 2.75 },
    uPxScale: { value: 1 },
    uTimeScale: { value: 0.5 },
    uPaletteColor: {
      value: new Float32Array(sanitizeRgb01(context.palette.accent)),
    },
  };
  const geometry = new Triangle(gl);
  const program = new Program(gl, {
    vertex,
    fragment: prismFragmentShader,
    uniforms,
  });
  if (!gl.getProgramParameter(program.program, gl.LINK_STATUS)) {
    const detail =
      gl.getProgramInfoLog(program.program) || "unknown link error";
    geometry.remove();
    program.remove();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    throw new Error(`Prism shader program failed to link: ${detail}`);
  }
  const mesh = new Mesh(gl, { geometry, program });
  context.host.replaceChildren(canvas);

  const random = () => Math.random();
  const wX = 0.3 + random() * 0.6;
  const wY = 0.2 + random() * 0.7;
  const wZ = 0.1 + random() * 0.5;
  const phX = random() * Math.PI * 2;
  const phZ = random() * Math.PI * 2;
  const startTime = performance.now();
  const pointer: { x: number; y: number; inside: boolean } = {
    ...PRISM_INITIAL_POINTER,
  };

  let frame = 0;
  let destroyed = false;
  let failed = false;
  let visible = context.visible;
  let reducedMotion = context.reducedMotion;
  let animationType = "rotate";
  let scale = 3.6;
  let noise = 0;
  let timeScale = 0.5;
  let yaw = 0;
  let pitch = 0;
  let roll = 0;
  let targetYaw = 0;
  let targetPitch = 0;
  let lastTime = 0;
  let backingSize: OglBackingSize | null = null;

  function fail(error?: unknown) {
    if (failed || destroyed) return;
    failed = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    context.reportRuntimeFailure(error);
  }
  function resize() {
    const width = context.host.clientWidth || 1;
    const height = context.host.clientHeight || 1;
    const effectiveDpr = Math.min(1.5, window.devicePixelRatio || 1);
    const nextSize: OglBackingSize = {
      cssWidth: width,
      cssHeight: height,
      effectiveDpr,
      renderScale: 1,
    };
    if (shouldResizeOglBacking(backingSize, nextSize)) {
      backingSize = nextSize;
      renderer.dpr = effectiveDpr;
      renderer.setSize(width, height);
      iResolution[0] = gl.drawingBufferWidth;
      iResolution[1] = gl.drawingBufferHeight;
      offsetPx[0] = 0 * effectiveDpr;
      offsetPx[1] = 0 * effectiveDpr;
    }
    uniforms.uPxScale.value = 1 / ((gl.drawingBufferHeight || 1) * 0.1 * scale);
    ensureFrame();
  }
  function onPointerMove(event: PointerEvent) {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    pointer.x = Math.max(
      -1,
      Math.min(1, (event.clientX - width * 0.5) / (width * 0.5)),
    );
    pointer.y = Math.max(
      -1,
      Math.min(1, (event.clientY - height * 0.5) / (height * 0.5)),
    );
    pointer.inside = true;
    ensureFrame();
  }
  function onLeave() {
    pointer.inside = false;
  }
  function onBlur() {
    pointer.inside = false;
  }
  function setAnimationType(next: string) {
    if (!shouldResetPrismAnimationState(animationType, next)) return;
    if (animationType === "hover") {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("blur", onBlur);
    }
    pointer.x = PRISM_INITIAL_POINTER.x;
    pointer.y = PRISM_INITIAL_POINTER.y;
    pointer.inside = PRISM_INITIAL_POINTER.inside;
    yaw = PRISM_INITIAL_EULER[0];
    pitch = PRISM_INITIAL_EULER[1];
    roll = PRISM_INITIAL_EULER[2];
    targetYaw = PRISM_INITIAL_EULER[0];
    targetPitch = PRISM_INITIAL_EULER[1];
    rotation.set(PRISM_INITIAL_ROTATION);
    uniforms.uRot.value = rotation;
    animationType = next;
    if (animationType === "hover") {
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      window.addEventListener("mouseleave", onLeave);
      window.addEventListener("blur", onBlur);
      uniforms.uUseBaseWobble.value = 0;
    } else {
      uniforms.uUseBaseWobble.value = animationType === "3drotate" ? 0 : 1;
    }
  }
  function onContextLost(event: Event) {
    event.preventDefault();
    fail(new Error("Prism WebGL context was lost"));
  }
  canvas.addEventListener("webglcontextlost", onContextLost);

  function draw(time: number) {
    frame = 0;
    if (destroyed || failed || !visible) return;
    if (!reducedMotion) lastTime = (time - startTime) * 0.001;
    uniforms.iTime.value = lastTime;
    let continueRaf = !reducedMotion;

    if (animationType === "hover") {
      targetYaw = (pointer.inside ? -pointer.x : 0) * 1.2;
      targetPitch = (pointer.inside ? pointer.y : 0) * 1.2;
      yaw += (targetYaw - yaw) * 0.05;
      pitch += (targetPitch - pitch) * 0.05;
      roll += (0 - roll) * 0.1;
      setMat3FromEuler(yaw, pitch, roll, rotation);
      if (
        noise < 1e-6 &&
        Math.abs(yaw - targetYaw) < 1e-4 &&
        Math.abs(pitch - targetPitch) < 1e-4 &&
        Math.abs(roll) < 1e-4
      ) {
        continueRaf = false;
      }
    } else if (animationType === "3drotate") {
      const scaled = lastTime * timeScale;
      yaw = scaled * wY;
      pitch = Math.sin(scaled * wX + phX) * 0.6;
      roll = Math.sin(scaled * wZ + phZ) * 0.5;
      setMat3FromEuler(yaw, pitch, roll, rotation);
      if (timeScale < 1e-6) continueRaf = false;
    } else {
      rotation.set([1, 0, 0, 0, 1, 0, 0, 0, 1]);
      uniforms.uRot.value = rotation;
      if (timeScale < 1e-6) continueRaf = false;
    }

    try {
      renderer.render({ scene: mesh });
      context.reportPaint?.();
    } catch (error) {
      fail(error);
      return;
    }
    if (continueRaf) frame = requestAnimationFrame(draw);
  }
  function ensureFrame() {
    if (!destroyed && !failed && visible && frame === 0)
      frame = requestAnimationFrame(draw);
  }
  function update(next: BackgroundUpdateContext) {
    visible = next.visible;
    reducedMotion = next.reducedMotion;
    const height = Math.max(0.001, Number(next.config.height));
    const baseHalf = Math.max(0.001, Number(next.config.baseWidth)) * 0.5;
    scale = Math.max(0.001, Number(next.config.scale));
    noise = Math.max(0, Number(next.config.noise));
    timeScale = Math.max(0, Number(next.config.timeScale));
    uniforms.uHeight.value = height;
    uniforms.uBaseHalf.value = baseHalf;
    uniforms.uGlow.value = Math.max(0, Number(next.config.glow));
    uniforms.uNoise.value = noise;
    uniforms.uScale.value = scale;
    uniforms.uHueShift.value = Number(next.config.hueShift) || 0;
    uniforms.uColorFreq.value = Math.max(
      0,
      Number(next.config.colorFrequency) || 1,
    );
    uniforms.uCenterShift.value = height * 0.25;
    uniforms.uInvBaseHalf.value = 1 / baseHalf;
    uniforms.uInvHeight.value = 1 / height;
    uniforms.uMinAxis.value = Math.min(baseHalf, height);
    uniforms.uTimeScale.value = Math.max(0, timeScale || 1);
    uniforms.uPaletteColor.value.set(sanitizeRgb01(next.palette.accent));
    setAnimationType(String(next.config.animationType));
    if (!visible && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    resize();
    ensureFrame();
  }

  animationType = "";
  update(context);
  return {
    resize,
    update,
    destroy() {
      destroyed = true;
      if (frame) cancelAnimationFrame(frame);
      setAnimationType("");
      canvas.removeEventListener("webglcontextlost", onContextLost);
      geometry.remove();
      program.remove();
      canvas.remove();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
