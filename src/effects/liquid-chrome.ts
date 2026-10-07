// Adapted from React Bits LiquidChrome.jsx at c7109dccb42e06592d1d9bc50bc87204697240e2.
// Copyright (c) 2026 David Haz. MIT + Commons Clause License Condition v1.0.
import { Mesh, Program, Renderer, Triangle } from "ogl";
import { shouldContinueOglAnimation } from "./ogl-math";
import type {
  BackgroundContext,
  BackgroundInstance,
  BackgroundUpdateContext,
} from "./runtime/contracts";

export const LIQUID_CHROME_INITIAL_POINTER: readonly [number, number] = [0, 0];

const vertex = `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const fragment = `
precision highp float;
uniform float uTime;
uniform vec3 uResolution;
uniform vec3 uBaseColor;
uniform float uAmplitude;
uniform float uFrequencyX;
uniform float uFrequencyY;
uniform vec2 uMouse;
varying vec2 vUv;

vec4 renderImage(vec2 uvCoord) {
    vec2 fragCoord = uvCoord * uResolution.xy;
    vec2 uv = (2.0 * fragCoord - uResolution.xy) / min(uResolution.x, uResolution.y);

    for (float i = 1.0; i < 10.0; i++){
        uv.x += uAmplitude / i * cos(i * uFrequencyX * uv.y + uTime + uMouse.x * 3.14159);
        uv.y += uAmplitude / i * cos(i * uFrequencyY * uv.x + uTime + uMouse.y * 3.14159);
    }

    vec2 diff = (uvCoord - uMouse);
    float dist = length(diff);
    float falloff = exp(-dist * 20.0);
    float ripple = sin(10.0 * dist - uTime * 2.0) * 0.03;
    uv += (diff / (dist + 0.0001)) * ripple * falloff;

    vec3 color = uBaseColor / abs(sin(uTime - uv.y - uv.x));
    return vec4(color, 1.0);
}

void main() {
    vec4 col = vec4(0.0);
    int samples = 0;
    for (int i = -1; i <= 1; i++){
        for (int j = -1; j <= 1; j++){
            vec2 offset = vec2(float(i), float(j)) * (1.0 / min(uResolution.x, uResolution.y));
            col += renderImage(vUv + offset);
            samples++;
        }
    }
    gl_FragColor = col / float(samples);
}`;

export function createLiquidChrome(
  context: BackgroundContext,
): BackgroundInstance {
  const renderer = new Renderer({ antialias: true });
  const gl = renderer.gl;
  const canvas = gl.canvas;
  canvas.className = "background-canvas";
  gl.clearColor(1, 1, 1, 1);

  const uniforms = {
    uTime: { value: 0 },
    uResolution: {
      value: new Float32Array([
        canvas.width,
        canvas.height,
        canvas.width / canvas.height,
      ]),
    },
    uBaseColor: { value: new Float32Array(context.palette.ink) },
    uAmplitude: { value: 0.3 },
    uFrequencyX: { value: 3 },
    uFrequencyY: { value: 3 },
    uMouse: { value: new Float32Array(LIQUID_CHROME_INITIAL_POINTER) },
  };
  const geometry = new Triangle(gl);
  const program = new Program(gl, { vertex, fragment, uniforms });
  if (!gl.getProgramParameter(program.program, gl.LINK_STATUS)) {
    const detail =
      gl.getProgramInfoLog(program.program) || "unknown link error";
    geometry.remove();
    program.remove();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    throw new Error(`Liquid Chrome shader program failed to link: ${detail}`);
  }
  const mesh = new Mesh(gl, { geometry, program });
  context.host.replaceChildren(canvas);

  let frame = 0;
  let destroyed = false;
  let failed = false;
  let visible = context.visible;
  let reducedMotion = context.reducedMotion;
  let speed = 0.3;
  let interactive = true;
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

  function setMouse(clientX: number, clientY: number) {
    const rect = context.host.getBoundingClientRect();
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom ||
      rect.width === 0 ||
      rect.height === 0
    )
      return;
    const mouse = uniforms.uMouse.value;
    mouse[0] = (clientX - rect.left) / rect.width;
    mouse[1] = 1 - (clientY - rect.top) / rect.height;
    ensureFrame();
  }
  function onMouseMove(event: MouseEvent) {
    setMouse(event.clientX, event.clientY);
  }
  function onTouchMove(event: TouchEvent) {
    const touch = event.touches[0];
    if (touch) setMouse(touch.clientX, touch.clientY);
  }
  function setInteractive(next: boolean) {
    if (next === interactive) return;
    interactive = next;
    if (interactive) {
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("touchmove", onTouchMove);
    } else {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("touchmove", onTouchMove);
      uniforms.uMouse.value.set(LIQUID_CHROME_INITIAL_POINTER);
      ensureFrame();
    }
  }

  function onContextLost(event: Event) {
    event.preventDefault();
    fail(new Error("Liquid Chrome WebGL context was lost"));
  }
  canvas.addEventListener("webglcontextlost", onContextLost);

  function draw(time: number) {
    frame = 0;
    if (destroyed || failed || !visible) return;
    if (!reducedMotion) lastTime = time * 0.001;
    uniforms.uTime.value = lastTime * speed;
    try {
      renderer.render({ scene: mesh });
      context.reportPaint?.();
    } catch (error) {
      fail(error);
      return;
    }
    if (shouldContinueOglAnimation(speed, reducedMotion))
      frame = requestAnimationFrame(draw);
  }
  function ensureFrame() {
    if (!destroyed && !failed && visible && frame === 0)
      frame = requestAnimationFrame(draw);
  }

  function update(next: BackgroundUpdateContext) {
    visible = next.visible;
    reducedMotion = next.reducedMotion;
    speed = Number(next.config.speed);
    uniforms.uAmplitude.value = Number(next.config.amplitude);
    uniforms.uBaseColor.value.set(next.palette.ink);
    setInteractive(Boolean(next.config.interactive));
    if (!visible && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    ensureFrame();
  }

  interactive = false;
  resize();
  update(context);
  return {
    resize,
    update,
    destroy() {
      destroyed = true;
      if (frame) cancelAnimationFrame(frame);
      setInteractive(false);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      geometry.remove();
      program.remove();
      canvas.remove();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
