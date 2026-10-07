import { requiredValue } from "./runtime/required-value";
// Adapted from React Bits src/ts-default/Backgrounds/GradientBlinds/GradientBlinds.tsx
// at c7109dccb42e06592d1d9bc50bc87204697240e2.
// Copyright (c) 2026 David Haz. MIT + Commons Clause License Condition v1.0.
import { Mesh, Program, Renderer, Triangle } from "ogl";
import type {
  BackgroundContext,
  BackgroundInstance,
  BackgroundUpdateContext,
} from "./runtime/contracts";

const vertex = `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

export const gradientBlindsFragmentShader = `
#ifdef GL_ES
precision mediump float;
#endif

uniform vec3  iResolution;
uniform vec2  iMouse;
uniform float iTime;

uniform float uAngle;
uniform float uNoise;
uniform float uBlindCount;
uniform float uSpotlightRadius;
uniform float uSpotlightSoftness;
uniform float uSpotlightOpacity;
uniform float uMirror;
uniform float uDistort;
uniform float uShineFlip;
uniform vec3  uColor0;
uniform vec3  uColor1;
uniform vec3  uColor2;
uniform vec3  uColor3;
uniform vec3  uColor4;
uniform vec3  uColor5;
uniform vec3  uColor6;
uniform vec3  uColor7;
uniform int   uColorCount;

varying vec2 vUv;

float rand(vec2 co){
  return fract(sin(dot(co, vec2(12.9898,78.233))) * 43758.5453);
}

vec2 rotate2D(vec2 p, float a){
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c) * p;
}

vec3 getGradientColor(float t){
  float tt = clamp(t, 0.0, 1.0);
  int count = uColorCount;
  if (count < 2) count = 2;
  float scaled = tt * float(count - 1);
  float seg = floor(scaled);
  float f = fract(scaled);

  if (seg < 1.0) return mix(uColor0, uColor1, f);
  if (seg < 2.0 && count > 2) return mix(uColor1, uColor2, f);
  if (seg < 3.0 && count > 3) return mix(uColor2, uColor3, f);
  if (seg < 4.0 && count > 4) return mix(uColor3, uColor4, f);
  if (seg < 5.0 && count > 5) return mix(uColor4, uColor5, f);
  if (seg < 6.0 && count > 6) return mix(uColor5, uColor6, f);
  if (seg < 7.0 && count > 7) return mix(uColor6, uColor7, f);
  if (count > 7) return uColor7;
  if (count > 6) return uColor6;
  if (count > 5) return uColor5;
  if (count > 4) return uColor4;
  if (count > 3) return uColor3;
  if (count > 2) return uColor2;
  return uColor1;
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 uv0 = fragCoord.xy / iResolution.xy;

    float aspect = iResolution.x / iResolution.y;
    vec2 p = uv0 * 2.0 - 1.0;
    p.x *= aspect;
    vec2 pr = rotate2D(p, uAngle);
    pr.x /= aspect;
    vec2 uv = pr * 0.5 + 0.5;

    vec2 uvMod = uv;
    if (uDistort > 0.0) {
      float a = uvMod.y * 6.0;
      float b = uvMod.x * 6.0;
      float w = 0.01 * uDistort;
      uvMod.x += sin(a) * w;
      uvMod.y += cos(b) * w;
    }
    float t = uvMod.x;
    if (uMirror > 0.5) {
      t = 1.0 - abs(1.0 - 2.0 * fract(t));
    }
    vec3 base = getGradientColor(t);

    vec2 offset = vec2(iMouse.x/iResolution.x, iMouse.y/iResolution.y);
  float d = length(uv0 - offset);
  float r = max(uSpotlightRadius, 1e-4);
  float dn = d / r;
  float spot = (1.0 - 2.0 * pow(dn, uSpotlightSoftness)) * uSpotlightOpacity;
  vec3 cir = vec3(spot);
  float stripe = fract(uvMod.x * max(uBlindCount, 1.0));
  if (uShineFlip > 0.5) stripe = 1.0 - stripe;
    vec3 ran = vec3(stripe);

    vec3 col = cir + base - ran;
    col += (rand(gl_FragCoord.xy + iTime) - 0.5) * uNoise;

    fragColor = vec4(col, 1.0);
}

void main() {
    vec4 color;
    mainImage(color, vUv * iResolution.xy);
    gl_FragColor = color;
}
`;

export function gradientBlindsAngleRadians(angle: number): number {
  return (angle * Math.PI) / 180;
}

export function effectiveBlindCount(
  width: number,
  blindCount: number,
  blindMinWidth: number,
): number {
  if (blindMinWidth > 0)
    return Math.max(1, Math.min(blindCount, Math.floor(width / blindMinWidth)));
  return Math.max(1, blindCount);
}

export function gradientBlindsDampingFactor(
  deltaSeconds: number,
  mouseDampening: number,
): number {
  return Math.min(
    1,
    1 - Math.exp(-deltaSeconds / Math.max(1e-4, mouseDampening)),
  );
}

const GRADIENT_BLINDS_CONTROL_KEYS = [
  "shineDirection",
  "angle",
  "noise",
  "blindCount",
  "blindMinWidth",
  "spotlightRadius",
  "distortAmount",
  "mouseDampening",
] as const;

type GradientBlindsDependencyValue = string | number | boolean;

export function gradientBlindsDependencyValues(
  state: Pick<BackgroundUpdateContext, "config" | "palette">,
): readonly GradientBlindsDependencyValue[] {
  return [
    ...GRADIENT_BLINDS_CONTROL_KEYS.map(
      (key) => state.config[key] as GradientBlindsDependencyValue,
    ),
    ...state.palette.accent,
    ...state.palette.focus,
  ];
}

export function gradientBlindsDependenciesChanged(
  previous: readonly GradientBlindsDependencyValue[] | null,
  next: readonly GradientBlindsDependencyValue[],
): boolean {
  return (
    previous !== null &&
    (previous.length !== next.length ||
      previous.some((value, index) => value !== next[index]))
  );
}

export function gradientBlindsRecreationTransition<T extends ArrayLike<number>>(
  mouseTarget: T,
  firstResize: boolean,
  lastTime: number,
) {
  return {
    iMouse: [0, 0] as const,
    iTime: 0,
    mouseTarget,
    firstResize,
    lastTime,
  };
}

export function createGradientBlinds(
  context: BackgroundContext,
): BackgroundInstance {
  // Bound pixel cost on high-DPR displays; retain source noise/time and CSS size.
  // Recreated renderers retain drawing-buffer pointer targets as upstream does.
  const renderer = new Renderer({
    dpr: Math.min(2, window.devicePixelRatio || 1),
    alpha: true,
    antialias: true,
  });
  const gl = renderer.gl;
  const canvas = gl.canvas;
  canvas.className = "background-canvas";
  // The generated mount is the framework-free equivalent of the official root.
  // Fixed live-demo JSX leaves this component default implicit.
  context.host.style.mixBlendMode = "lighten";
  const colors = [
    new Float32Array(context.palette.accent),
    new Float32Array(context.palette.focus),
    ...Array.from({ length: 6 }, () => new Float32Array(context.palette.focus)),
  ];
  const uniforms = {
    iResolution: { value: [gl.drawingBufferWidth, gl.drawingBufferHeight, 1] },
    iMouse: { value: new Float32Array([0, 0]) },
    iTime: { value: 0 },
    uAngle: { value: gradientBlindsAngleRadians(20) },
    uNoise: { value: 0.5 },
    uBlindCount: { value: 16 },
    // Fixed demo JSX relies on these component defaults.
    uSpotlightRadius: { value: 0.5 },
    uSpotlightSoftness: { value: 1 },
    uSpotlightOpacity: { value: 1 },
    uMirror: { value: 0 },
    uDistort: { value: 0 },
    uShineFlip: { value: 0 },
    uColor0: { value: requiredValue(colors[0]) },
    uColor1: { value: requiredValue(colors[1]) },
    uColor2: { value: requiredValue(colors[2]) },
    uColor3: { value: requiredValue(colors[3]) },
    uColor4: { value: requiredValue(colors[4]) },
    uColor5: { value: requiredValue(colors[5]) },
    uColor6: { value: requiredValue(colors[6]) },
    uColor7: { value: requiredValue(colors[7]) },
    uColorCount: { value: 2 },
  };
  const program = new Program(gl, {
    vertex,
    fragment: gradientBlindsFragmentShader,
    uniforms,
  });
  const geometry = new Triangle(gl);
  if (!gl.getProgramParameter(program.program, gl.LINK_STATUS)) {
    const detail =
      gl.getProgramInfoLog(program.program) || "unknown link error";
    geometry.remove();
    program.remove();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    throw new Error(`Gradient Blinds shader program failed to link: ${detail}`);
  }
  const mesh = new Mesh(gl, { geometry, program });
  context.host.replaceChildren(canvas);

  let frame = 0;
  let destroyed = false;
  let failed = false;
  let visible = context.visible;
  let reducedMotion = context.reducedMotion;
  let noise = 0.5;
  let blindCount = 16;
  let blindMinWidth = 60;
  let mouseDampening = 0.15;
  let firstResize = true;
  let lastTime = 0;
  let sizedWidth = -1;
  let sizedHeight = -1;
  let sizedDpr = -1;
  const mouseTarget = new Float32Array([0, 0]);
  let dependencyValues: readonly GradientBlindsDependencyValue[] | null = null;

  function fail(error?: unknown) {
    if (destroyed || failed) return;
    failed = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    context.reportRuntimeFailure(error);
  }
  function contextLost(event: Event) {
    event.preventDefault();
    fail(new Error("Gradient Blinds WebGL context was lost"));
  }
  canvas.addEventListener("webglcontextlost", contextLost);

  function pointerMove(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    if (
      rect.width === 0 ||
      rect.height === 0 ||
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      return;
    const scale = renderer.dpr || 1;
    mouseTarget[0] = (event.clientX - rect.left) * scale;
    mouseTarget[1] = (rect.height - (event.clientY - rect.top)) * scale;
    if (mouseDampening <= 0) uniforms.iMouse.value.set(mouseTarget);
    ensureFrame();
  }
  window.addEventListener("pointermove", pointerMove, { passive: true });

  function pointerIsSettled(): boolean {
    return (
      Math.abs(
        requiredValue(mouseTarget[0]) - requiredValue(uniforms.iMouse.value[0]),
      ) < 0.01 &&
      Math.abs(
        requiredValue(mouseTarget[1]) - requiredValue(uniforms.iMouse.value[1]),
      ) < 0.01
    );
  }
  function draw(time: number) {
    frame = 0;
    if (destroyed || failed || !visible) return;
    if (!reducedMotion) uniforms.iTime.value = time * 0.001;
    if (mouseDampening > 0) {
      if (!lastTime) lastTime = time;
      const factor = gradientBlindsDampingFactor(
        (time - lastTime) / 1000,
        mouseDampening,
      );
      lastTime = time;
      uniforms.iMouse.value[0] =
        requiredValue(uniforms.iMouse.value[0]) +
        (requiredValue(mouseTarget[0]) -
          requiredValue(uniforms.iMouse.value[0])) *
          factor;
      uniforms.iMouse.value[1] =
        requiredValue(uniforms.iMouse.value[1]) +
        (requiredValue(mouseTarget[1]) -
          requiredValue(uniforms.iMouse.value[1])) *
          factor;
    } else {
      lastTime = time;
    }
    try {
      renderer.render({ scene: mesh });
      context.reportPaint?.();
    } catch (error) {
      fail(error);
      return;
    }
    if (!reducedMotion && (noise !== 0 || !pointerIsSettled()))
      frame = requestAnimationFrame(draw);
  }
  function ensureFrame() {
    if (!destroyed && !failed && visible && frame === 0) {
      // The pinned loop keeps lastTimeRef current even while its output is settled.
      // Rebase the retained ref when this no-output scheduler wakes so damping still
      // resumes with a frame-sized delta instead of jumping straight to the target.
      if (lastTime) lastTime = performance.now();
      frame = requestAnimationFrame(draw);
    }
  }
  function resize() {
    const rect = context.host.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (
      rect.width !== sizedWidth ||
      rect.height !== sizedHeight ||
      dpr !== sizedDpr
    ) {
      sizedWidth = rect.width;
      sizedHeight = rect.height;
      sizedDpr = dpr;
      renderer.dpr = dpr;
      renderer.setSize(rect.width, rect.height);
      uniforms.iResolution.value = [
        gl.drawingBufferWidth,
        gl.drawingBufferHeight,
        1,
      ];
      uniforms.uBlindCount.value = effectiveBlindCount(
        rect.width,
        blindCount,
        blindMinWidth,
      );
      if (firstResize) {
        firstResize = false;
        mouseTarget[0] = gl.drawingBufferWidth / 2;
        mouseTarget[1] = gl.drawingBufferHeight / 2;
        uniforms.iMouse.value.set(mouseTarget);
      }
    }
    ensureFrame();
  }
  function recreateEffectState() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    const transition = gradientBlindsRecreationTransition(
      mouseTarget,
      firstResize,
      lastTime,
    );
    uniforms.iMouse.value.set(transition.iMouse);
    uniforms.iTime.value = transition.iTime;
    firstResize = transition.firstResize;
    lastTime = transition.lastTime;
    // Recreating the pinned renderer always reapplies size and the then-current DPR,
    // but its persistent pointer target is deliberately not rescaled.
    sizedWidth = -1;
    sizedHeight = -1;
    sizedDpr = -1;
    resize();
  }
  function update(next: BackgroundUpdateContext) {
    visible = next.visible;
    reducedMotion = next.reducedMotion;
    const config = next.config;
    const nextDependencyValues = gradientBlindsDependencyValues(next);
    const recreatesEffect = gradientBlindsDependenciesChanged(
      dependencyValues,
      nextDependencyValues,
    );
    dependencyValues = nextDependencyValues;
    blindCount = Number(config.blindCount);
    blindMinWidth = Number(config.blindMinWidth);
    mouseDampening = Number(config.mouseDampening);
    noise = Number(config.noise);
    uniforms.uAngle.value = gradientBlindsAngleRadians(Number(config.angle));
    uniforms.uNoise.value = noise;
    uniforms.uBlindCount.value = effectiveBlindCount(
      context.host.getBoundingClientRect().width,
      blindCount,
      blindMinWidth,
    );
    uniforms.uSpotlightRadius.value = Number(config.spotlightRadius);
    uniforms.uDistort.value = Number(config.distortAmount);
    uniforms.uShineFlip.value = config.shineDirection === "right" ? 1 : 0;
    requiredValue(colors[0]).set(next.palette.accent);
    for (let index = 1; index < colors.length; index++)
      requiredValue(colors[index]).set(next.palette.focus);
    if (recreatesEffect) {
      recreateEffectState();
    } else {
      if (!visible && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      ensureFrame();
    }
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
      canvas.removeEventListener("webglcontextlost", contextLost);
      geometry.remove();
      program.remove();
      canvas.remove();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
