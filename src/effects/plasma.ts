// Adapted from React Bits Plasma.tsx at c7109dccb42e06592d1d9bc50bc87204697240e2.
// Copyright (c) 2026 David Haz. MIT + Commons Clause License Condition v1.0.
import { Mesh, Program, Renderer, Triangle } from "ogl";
import {
  plasmaPingPongTime,
  shouldResizeOglBacking,
  type OglBackingSize,
} from "./ogl-math";
import type {
  BackgroundContext,
  BackgroundInstance,
  BackgroundUpdateContext,
} from "./runtime/contracts";

const vertex = `#version 300 es
precision highp float;
in vec2 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const fragment = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform vec3 uCustomColor;
uniform float uUseCustomColor;
uniform float uSpeed;
uniform float uDirection;
uniform float uScale;
uniform float uOpacity;
uniform vec2 uMouse;
uniform float uMouseInteractive;
uniform float uQuality;
uniform float uStepScale;
out vec4 fragColor;

void mainImage(out vec4 o, vec2 C) {
  vec2 center = iResolution.xy * 0.5;
  C = (C - center) / uScale + center;
  vec2 mouseOffset = (uMouse - center) * 0.0002;
  C += mouseOffset * length(C - center) * step(0.5, uMouseInteractive);
  float i, d, z, T = iTime * uSpeed * uDirection;
  vec3 O, p, S;
  for (vec2 r = iResolution.xy, Q; ++i < 60.0; O += o.w/d*o.xyz) {
    p = z*normalize(vec3(C-.5*r,r.y));
    p.z -= 4.;
    S = p;
    d = p.y-T;
    p.x += .4*(1.+p.y)*sin(d + p.x*0.1)*cos(.34*d + p.x*0.05);
    Q = p.xz *= mat2(cos(p.y+vec4(0,11,33,0)-T));
    z += d = (abs(sqrt(length(Q*Q)) - .25*(5.+S.y))/3.+8e-4) * uStepScale;
    o = 1.+sin(S.y+p.z*.5+S.z-length(S-p)+vec4(2,1,0,8));
    if (i >= uQuality) break;
  }
  o.xyz = tanh(O/1e4);
}

bool finite1(float x){ return !(isnan(x) || isinf(x)); }
vec3 sanitize(vec3 c){
  return vec3(
    finite1(c.r) ? c.r : 0.0,
    finite1(c.g) ? c.g : 0.0,
    finite1(c.b) ? c.b : 0.0
  );
}

void main() {
  vec4 o = vec4(0.0);
  mainImage(o, gl_FragCoord.xy);
  vec3 rgb = sanitize(o.rgb);
  float intensity = (rgb.r + rgb.g + rgb.b) / 3.0;
  vec3 customColor = intensity * uCustomColor;
  vec3 finalColor = mix(rgb, customColor, step(0.5, uUseCustomColor));
  float alpha = length(rgb) * uOpacity;
  fragColor = vec4(finalColor, alpha);
}`;

const ORIGINAL_QUALITY = 60;

export const PLASMA_INITIAL_POINTER = [0, 0] as const;

export function shouldResetPlasmaPointer(
  wasInteractive: boolean,
  isInteractive: boolean,
): boolean {
  return wasInteractive && !isInteractive;
}

export function createPlasma(context: BackgroundContext): BackgroundInstance {
  const renderer = new Renderer({
    webgl: 2,
    alpha: true,
    antialias: false,
    dpr: Math.min(window.devicePixelRatio || 1, Number(context.config.maxDpr)),
  });
  const gl = renderer.gl;
  const canvas = gl.canvas;
  if (!renderer.isWebgl2) {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    throw new Error("Plasma requires WebGL2");
  }
  canvas.className = "background-canvas";
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";

  const uniforms = {
    iTime: { value: 0 },
    iResolution: { value: new Float32Array([1, 1]) },
    uCustomColor: { value: new Float32Array(context.palette.accent) },
    uUseCustomColor: { value: 1 },
    uSpeed: { value: 0.4 },
    uDirection: { value: 1 },
    uScale: { value: 1 },
    uOpacity: { value: 1 },
    uMouse: { value: new Float32Array(PLASMA_INITIAL_POINTER) },
    uMouseInteractive: { value: 0 },
    uQuality: { value: 60 },
    uStepScale: { value: 1 },
  };
  const geometry = new Triangle(gl);
  const program = new Program(gl, { vertex, fragment, uniforms });
  if (!gl.getProgramParameter(program.program, gl.LINK_STATUS)) {
    const detail =
      gl.getProgramInfoLog(program.program) || "unknown link error";
    geometry.remove();
    program.remove();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    throw new Error(`Plasma shader program failed to link: ${detail}`);
  }
  const mesh = new Mesh(gl, { geometry, program });
  context.host.replaceChildren(canvas);

  let frame = 0;
  let destroyed = false;
  let failed = false;
  let visible = context.visible;
  let intersecting = true;
  let reducedMotion = context.reducedMotion;
  let mouseInteractive = false;
  let direction = "forward";
  let renderScale = 0.55;
  let maxDpr = 1.5;
  let targetFps = 60;
  let lastFrameTime = 0;
  const startTime = performance.now();
  let pendingMouse: { x: number; y: number } | null = null;
  let backingSize: OglBackingSize | null = null;

  function fail(error?: unknown) {
    if (failed || destroyed) return;
    failed = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    context.reportRuntimeFailure(error);
  }
  function resize() {
    const rect = context.host.getBoundingClientRect();
    const effectiveDpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    const nextSize: OglBackingSize = {
      cssWidth: rect.width,
      cssHeight: rect.height,
      effectiveDpr,
      renderScale,
    };
    if (shouldResizeOglBacking(backingSize, nextSize)) {
      backingSize = nextSize;
      const width = Math.max(1, Math.floor(rect.width * renderScale));
      const height = Math.max(1, Math.floor(rect.height * renderScale));
      renderer.dpr = effectiveDpr;
      renderer.setSize(width, height);
      // OGL writes pixel CSS dimensions in setSize; pinned Plasma stretches the
      // lower-resolution render buffer back over the complete host footprint.
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      uniforms.iResolution.value[0] = gl.drawingBufferWidth;
      uniforms.iResolution.value[1] = gl.drawingBufferHeight;
    }
    ensureFrame();
  }
  function onMouseMove(event: MouseEvent) {
    const rect = context.host.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      return;
    // Deliberate pinned-source quirk: retain CSS-pixel, top-origin coordinates
    // rather than aligning the pointer to renderScale/DPR drawing-buffer space.
    pendingMouse = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    ensureFrame();
  }
  function setMouseInteractive(next: boolean) {
    if (next === mouseInteractive) return;
    const resetPointer = shouldResetPlasmaPointer(mouseInteractive, next);
    mouseInteractive = next;
    if (mouseInteractive) {
      window.addEventListener("mousemove", onMouseMove, { passive: true });
    } else {
      window.removeEventListener("mousemove", onMouseMove);
      if (resetPointer) {
        pendingMouse = null;
        uniforms.uMouse.value[0] = PLASMA_INITIAL_POINTER[0];
        uniforms.uMouse.value[1] = PLASMA_INITIAL_POINTER[1];
        ensureFrame();
      }
    }
  }
  function onContextLost(event: Event) {
    event.preventDefault();
    fail(new Error("Plasma WebGL context was lost"));
  }
  canvas.addEventListener("webglcontextlost", onContextLost);

  const intersectionObserver =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(
          ([entry]) => {
            intersecting = entry?.isIntersecting ?? false;
            if (!intersecting && frame) {
              cancelAnimationFrame(frame);
              frame = 0;
            }
            ensureFrame();
          },
          { threshold: 0 },
        );
  intersectionObserver?.observe(context.host);

  function draw(time: number) {
    frame = 0;
    if (destroyed || failed || !visible || !intersecting) return;
    const interval = 1000 / targetFps;
    if (!reducedMotion && time - lastFrameTime < interval) {
      frame = requestAnimationFrame(draw);
      return;
    }
    lastFrameTime = time;
    if (pendingMouse) {
      uniforms.uMouse.value[0] = pendingMouse.x;
      uniforms.uMouse.value[1] = pendingMouse.y;
      pendingMouse = null;
    }
    const elapsed = reducedMotion ? 0 : (time - startTime) * 0.001;
    if (direction === "pingpong") {
      uniforms.uDirection.value = 1;
      uniforms.iTime.value = plasmaPingPongTime(elapsed);
    } else {
      uniforms.iTime.value = elapsed;
    }
    try {
      renderer.render({ scene: mesh });
      context.reportPaint?.();
    } catch (error) {
      fail(error);
      return;
    }
    if (!reducedMotion) frame = requestAnimationFrame(draw);
  }
  function ensureFrame() {
    if (!destroyed && !failed && visible && intersecting && frame === 0)
      frame = requestAnimationFrame(draw);
  }
  function update(next: BackgroundUpdateContext) {
    visible = next.visible;
    reducedMotion = next.reducedMotion;
    direction = String(next.config.direction);
    uniforms.uCustomColor.value.set(next.palette.accent);
    uniforms.uSpeed.value = Number(next.config.speed) * 0.4;
    uniforms.uDirection.value = direction === "reverse" ? -1 : 1;
    uniforms.uScale.value = Number(next.config.scale);
    uniforms.uOpacity.value = Number(next.config.opacity);
    const iterations = Number(next.config.iterations);
    uniforms.uQuality.value = iterations;
    uniforms.uStepScale.value = ORIGINAL_QUALITY / iterations;
    renderScale = Number(next.config.renderScale);
    targetFps = Number(next.config.targetFps);
    maxDpr = Number(next.config.maxDpr);
    uniforms.uMouseInteractive.value = next.config.mouseInteractive ? 1 : 0;
    setMouseInteractive(Boolean(next.config.mouseInteractive));
    if (!visible && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    resize();
    ensureFrame();
  }

  update(context);
  return {
    resize,
    update,
    destroy() {
      destroyed = true;
      if (frame) cancelAnimationFrame(frame);
      setMouseInteractive(false);
      intersectionObserver?.disconnect();
      canvas.removeEventListener("webglcontextlost", onContextLost);
      geometry.remove();
      program.remove();
      canvas.remove();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
