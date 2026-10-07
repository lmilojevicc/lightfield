// Adapted from React Bits Iridescence.jsx at c7109dccb42e06592d1d9bc50bc87204697240e2.
// Copyright (c) 2026 David Haz. MIT + Commons Clause License Condition v1.0.
import { Mesh, Program, Renderer, Triangle } from "ogl";
import { shouldContinueOglAnimation } from "./ogl-math";
import type {
  BackgroundContext,
  BackgroundInstance,
  BackgroundUpdateContext,
} from "./runtime/contracts";

export const IRIDESCENCE_INITIAL_POINTER: readonly [number, number] = [
  0.5, 0.5,
];

const vertex = `
attribute vec2 uv;
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0, 1);
}`;

const fragment = `
precision highp float;
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uResolution;
uniform vec2 uMouse;
uniform float uAmplitude;
uniform float uSpeed;
uniform vec3 uPaperColor;
uniform float uLift;
varying vec2 vUv;

void main() {
  float mr = min(uResolution.x, uResolution.y);
  vec2 uv = (vUv.xy * 2.0 - 1.0) * uResolution.xy / mr;
  uv += (uMouse - vec2(0.5)) * uAmplitude;
  float d = -uTime * 0.5 * uSpeed;
  float a = 0.0;
  for (float i = 0.0; i < 8.0; ++i) {
    a += cos(i - d - a * uv.x);
    d += sin(uv.y * i + a);
  }
  d += uTime * 0.5 * uSpeed;
  vec3 col = vec3(cos(uv * vec2(d, a)) * 0.6 + 0.4, cos(a + d) * 0.5 + 0.5);
  col = cos(col * cos(vec3(d, a, 2.5)) * 0.5 + 0.5) * uColor;
  col = mix(col, uPaperColor, uLift);
  gl_FragColor = vec4(col, 1.0);
}`;

export function createIridescence(
  context: BackgroundContext,
): BackgroundInstance {
  const renderer = new Renderer();
  const gl = renderer.gl;
  const canvas = gl.canvas;
  canvas.className = "background-canvas";
  gl.clearColor(1, 1, 1, 1);

  const uniforms = {
    uTime: { value: 0 },
    uColor: { value: new Float32Array(context.palette.accent) },
    uResolution: {
      value: new Float32Array([
        canvas.width,
        canvas.height,
        canvas.width / canvas.height,
      ]),
    },
    uMouse: { value: new Float32Array(IRIDESCENCE_INITIAL_POINTER) },
    uAmplitude: { value: 0.1 },
    uSpeed: { value: 1 },
    uPaperColor: { value: new Float32Array(context.palette.paper) },
    uLift: { value: context.palette.lightTheme ? 0.85 : 0 },
  };
  const geometry = new Triangle(gl);
  const program = new Program(gl, { vertex, fragment, uniforms });
  if (!gl.getProgramParameter(program.program, gl.LINK_STATUS)) {
    const detail =
      gl.getProgramInfoLog(program.program) || "unknown link error";
    geometry.remove();
    program.remove();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    throw new Error(`Iridescence shader program failed to link: ${detail}`);
  }
  const mesh = new Mesh(gl, { geometry, program });
  context.host.replaceChildren(canvas);

  let frame = 0;
  let destroyed = false;
  let failed = false;
  let visible = context.visible;
  let reducedMotion = context.reducedMotion;
  let mouseReact = true;
  let lastTime = 0;

  function fail(error?: unknown) {
    if (failed || destroyed) return;
    failed = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    context.reportRuntimeFailure(error);
  }
  function resize() {
    renderer.setSize(context.host.offsetWidth, context.host.offsetHeight);
    const resolution = uniforms.uResolution.value;
    resolution[0] = canvas.width;
    resolution[1] = canvas.height;
    resolution[2] = canvas.width / canvas.height;
    ensureFrame();
  }
  function onMouseMove(event: MouseEvent) {
    const rect = context.host.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom ||
      rect.width === 0 ||
      rect.height === 0
    )
      return;
    uniforms.uMouse.value[0] = (event.clientX - rect.left) / rect.width;
    uniforms.uMouse.value[1] = 1 - (event.clientY - rect.top) / rect.height;
    ensureFrame();
  }
  function setMouseReact(next: boolean) {
    if (next === mouseReact) return;
    mouseReact = next;
    if (mouseReact) window.addEventListener("mousemove", onMouseMove);
    else {
      window.removeEventListener("mousemove", onMouseMove);
      uniforms.uMouse.value.set(IRIDESCENCE_INITIAL_POINTER);
      ensureFrame();
    }
  }
  function onContextLost(event: Event) {
    event.preventDefault();
    fail(new Error("Iridescence WebGL context was lost"));
  }
  canvas.addEventListener("webglcontextlost", onContextLost);

  function draw(time: number) {
    frame = 0;
    if (destroyed || failed || !visible) return;
    if (!reducedMotion) lastTime = time * 0.001;
    uniforms.uTime.value = lastTime;
    try {
      renderer.render({ scene: mesh });
      context.reportPaint?.();
    } catch (error) {
      fail(error);
      return;
    }
    if (shouldContinueOglAnimation(uniforms.uSpeed.value, reducedMotion))
      frame = requestAnimationFrame(draw);
  }
  function ensureFrame() {
    if (!destroyed && !failed && visible && frame === 0)
      frame = requestAnimationFrame(draw);
  }
  function update(next: BackgroundUpdateContext) {
    visible = next.visible;
    reducedMotion = next.reducedMotion;
    uniforms.uColor.value.set(next.palette.accent);
    uniforms.uPaperColor.value.set(next.palette.paper);
    uniforms.uLift.value = next.palette.lightTheme ? 0.85 : 0;
    uniforms.uSpeed.value = Number(next.config.speed);
    setMouseReact(Boolean(next.config.mouseReact));
    if (!visible && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    ensureFrame();
  }

  mouseReact = false;
  resize();
  update(context);
  return {
    resize,
    update,
    destroy() {
      destroyed = true;
      if (frame) cancelAnimationFrame(frame);
      setMouseReact(false);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      geometry.remove();
      program.remove();
      canvas.remove();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
