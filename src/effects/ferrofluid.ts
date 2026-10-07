import { requiredValue } from "./runtime/required-value";
// Adapted from React Bits src/ts-default/Backgrounds/Ferrofluid/Ferrofluid.tsx
// at 4022efa12a8763a2aeb10768ad0b390d30b6d960. See THIRD_PARTY_NOTICES.md.
import { Mesh, Program, Renderer, Triangle } from "ogl";
import type {
  BackgroundContext,
  BackgroundInstance,
  BackgroundUpdateContext,
} from "./runtime/contracts";

type RGB = [number, number, number];
export type FerrofluidDirection = "up" | "down" | "left" | "right";

const MAX_COLORS = 8;
export const FERROFLUID_INITIAL_MOUSE: readonly [number, number] = [0, 0];

export function prepareFerrofluidColors(input: readonly RGB[]) {
  const base = (input.length ? input : [[0, 0, 0] as RGB]).slice(0, MAX_COLORS);
  const count = base.length;
  const colors: RGB[] = [];
  for (let index = 0; index < MAX_COLORS; index++)
    colors.push([
      ...requiredValue(base[Math.min(index, base.length - 1)]),
    ] as RGB);
  const average: RGB = [0, 0, 0];
  for (let index = 0; index < count; index++) {
    average[0] += requiredValue(colors[index])[0];
    average[1] += requiredValue(colors[index])[1];
    average[2] += requiredValue(colors[index])[2];
  }
  average[0] /= count;
  average[1] /= count;
  average[2] /= count;
  return { colors, count, average };
}

export function ferrofluidFlowVector(
  direction?: string,
): readonly [number, number] {
  switch (direction) {
    case "up":
      return [0, 1];
    case "down":
      return [0, -1];
    case "left":
      return [-1, 0];
    case "right":
      return [1, 0];
    default:
      return [0, -1];
  }
}

export function ferrofluidDampingFactor(
  deltaSeconds: number,
  mouseDampening = 0.15,
): number {
  return Math.min(
    1,
    1 - Math.exp(-deltaSeconds / Math.max(1e-4, mouseDampening)),
  );
}

export function ferrofluidPointerCoordinates(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, "left" | "top" | "width" | "height">,
  dpr: number,
): readonly [number, number] | null {
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    clientX < rect.left ||
    clientX > rect.left + rect.width ||
    clientY < rect.top ||
    clientY > rect.top + rect.height
  )
    return null;
  return [
    (clientX - rect.left) * dpr,
    (rect.height - (clientY - rect.top)) * dpr,
  ];
}

export function ferrofluidMouseSettled(
  current: ArrayLike<number>,
  target: ArrayLike<number>,
  epsilon = 0.01,
): boolean {
  return (
    Math.abs(requiredValue(current[0]) - requiredValue(target[0])) <= epsilon &&
    Math.abs(requiredValue(current[1]) - requiredValue(target[1])) <= epsilon
  );
}

export function shouldAnimateFerrofluid(
  speed: number,
  reducedMotion: boolean,
  interaction: boolean,
  current: ArrayLike<number>,
  target: ArrayLike<number>,
): boolean {
  return (
    !reducedMotion &&
    (speed !== 0 || (interaction && !ferrofluidMouseSettled(current, target)))
  );
}

export function ferrofluidDependencySnapshot(
  config: Record<string, unknown>,
  ink: readonly number[],
): string {
  return JSON.stringify([
    Boolean(config.mouseInteraction),
    String(config.flowDirection),
    Number(config.speed),
    Number(config.scale),
    Number(config.turbulence),
    Number(config.fluidity),
    Number(config.rimWidth),
    Number(config.sharpness),
    Number(config.shimmer),
    Number(config.glow),
    Number(config.mouseStrength),
    Number(config.mouseRadius),
    ink[0],
    ink[1],
    ink[2],
  ]);
}

export const ferrofluidVertexShader = `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

export const ferrofluidFragmentShader = `
precision highp float;

uniform vec3  iResolution;
uniform vec2  iMouse;
uniform float iTime;

uniform vec3  uColor0;
uniform vec3  uColor1;
uniform vec3  uColor2;
uniform vec3  uColor3;
uniform vec3  uColor4;
uniform vec3  uColor5;
uniform vec3  uColor6;
uniform vec3  uColor7;
uniform int   uColorCount;

uniform vec3  uMouseColor;
uniform vec2  uFlow;
uniform float uSpeed;
uniform float uScale;
uniform float uTurbulence;
uniform float uFluidity;
uniform float uRimWidth;
uniform float uSharpness;
uniform float uShimmer;
uniform float uGlow;
uniform float uOpacity;
uniform float uMouseEnabled;
uniform float uMouseStrength;
uniform float uMouseRadius;

varying vec2 vUv;

#define PI 3.14159265

vec3 palette(float h) {
  int count = uColorCount;
  if (count < 1) count = 1;
  int idx = int(floor(clamp(h, 0.0, 0.999999) * float(count)));
  if (idx <= 0) return uColor0;
  if (idx == 1) return uColor1;
  if (idx == 2) return uColor2;
  if (idx == 3) return uColor3;
  if (idx == 4) return uColor4;
  if (idx == 5) return uColor5;
  if (idx == 6) return uColor6;
  return uColor7;
}

float hash(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float smin(float a, float b, float k) {
  float r = exp2(-a / k) + exp2(-b / k);
  return -k * log2(r);
}

float sinlerp(float a, float b, float w) {
  return mix(a, b, (sin(w * PI - PI / 2.0) + 1.0) / 2.0);
}

float vn(vec2 p, float s, float seed) {
  vec2 cellp = floor(p / s);
  vec2 relp = mod(p, s);
  float g1 = hash(vec3(cellp, seed));
  float g2 = hash(vec3(cellp.x + 1.0, cellp.y, seed));
  float g3 = hash(vec3(cellp.x + 1.0, cellp.y + 1.0, seed));
  float g4 = hash(vec3(cellp.x, cellp.y + 1.0, seed));
  float bx = sinlerp(g1, g2, relp.x / s);
  float tx = sinlerp(g4, g3, relp.x / s);
  return sinlerp(bx, tx, relp.y / s);
}

float dbn(vec2 p, float s, float seed) {
  float o = s / 2.0;
  float n0 = vn(p, s, seed);
  float n1 = vn(p + vec2(o, o), s, seed + 0.1);
  float n2 = vn(p + vec2(-o, o), s, seed + 0.2);
  float n3 = vn(p + vec2(o, -o), s, seed + 0.3);
  float n4 = vn(p + vec2(-o, -o), s, seed + 0.4);
  return (2.0 * n0 + 1.5 * n1 + 1.25 * n2 + 1.125 * n3 + n4) / 7.0;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  float ref = 700.0 / max(uScale, 0.05);
  vec2 p = fragCoord / iResolution.y * ref;

  float spd = 200.0 * uSpeed;
  float t = iTime;

  vec2 dir = uFlow;
  vec2 perp = vec2(-dir.y, dir.x);

  float distort1 = vn(p + perp * (t * spd), 60.0, 10.0) * 50.0 * uTurbulence;
  float distort2 = vn(p - perp * (t * spd), 120.0, 15.0) * 100.0 * uTurbulence;

  float peaks = dbn(p + distort1 + dir * (t * spd * 0.5), 40.0, 1.0);
  float peaks2 = dbn(p + distort2 - dir * (t * spd * 0.5), 40.0, 0.0);

  float mapeaks = smin(peaks, peaks2, max(uFluidity, 0.001));

  float mGlow = 0.0;
  if (uMouseEnabled > 0.5) {
    vec2 mp = iMouse / iResolution.y * ref;
    float md = length(p - mp) / ref;
    float rr = max(uMouseRadius, 0.02);
    mGlow = exp(-md * md / (rr * rr)) * uMouseStrength;
  }

  float band = (uRimWidth - abs((mapeaks - 0.4) * 2.0)) * 5.0;
  float ltn = clamp(band - vn(p + dir * (t * spd * 0.5), 60.0, 12.0) * uShimmer, 0.0, 1.0);
  ltn = pow(ltn, uSharpness) * uGlow;
  ltn *= clamp(1.0 - mGlow, 0.0, 1.0);

  float h = clamp(0.5 + (peaks - peaks2) * 0.8, 0.0, 1.0);
  vec3 col = palette(h);

  vec3 outc = col * ltn;
  float a = clamp(max(outc.r, max(outc.g, outc.b)), 0.0, 1.0);
  fragColor = vec4(outc, a * uOpacity);
}

void main() {
  vec4 color;
  mainImage(color, vUv * iResolution.xy);
  gl_FragColor = color;
}
`;

export function createFerrofluid(
  context: BackgroundContext,
): BackgroundInstance {
  const renderer = new Renderer({
    dpr: window.devicePixelRatio || 1,
    alpha: true,
    antialias: true,
  });
  const gl = renderer.gl;
  const canvas = gl.canvas;
  const cleanupStack: Array<() => void> = [];
  let cleaned = false;
  function cleanupOwned() {
    if (cleaned) return;
    cleaned = true;
    for (let index = cleanupStack.length - 1; index >= 0; index--) {
      try {
        requiredValue(cleanupStack[index])();
      } catch {
        // Continue releasing independently owned resources.
      }
    }
  }
  cleanupStack.push(() => {
    canvas.remove();
  });
  cleanupStack.push(() => gl.getExtension("WEBGL_lose_context")?.loseContext());

  try {
    canvas.className = "background-canvas";
    gl.clearColor(0, 0, 0, 0);

    const prepared = prepareFerrofluidColors([
      context.palette.ink,
      context.palette.ink,
      context.palette.ink,
    ]);
    const colors = prepared.colors.map((color) => new Float32Array(color));
    const average = new Float32Array(prepared.average);
    const uniforms = {
      iResolution: {
        value: [gl.drawingBufferWidth, gl.drawingBufferHeight, 1],
      },
      iMouse: { value: new Float32Array(FERROFLUID_INITIAL_MOUSE) },
      iTime: { value: 0 },
      uColor0: { value: requiredValue(colors[0]) },
      uColor1: { value: requiredValue(colors[1]) },
      uColor2: { value: requiredValue(colors[2]) },
      uColor3: { value: requiredValue(colors[3]) },
      uColor4: { value: requiredValue(colors[4]) },
      uColor5: { value: requiredValue(colors[5]) },
      uColor6: { value: requiredValue(colors[6]) },
      uColor7: { value: requiredValue(colors[7]) },
      uColorCount: { value: prepared.count },
      uMouseColor: { value: average },
      uFlow: {
        value: new Float32Array(
          ferrofluidFlowVector(String(context.config.flowDirection)),
        ),
      },
      uSpeed: { value: Number(context.config.speed) },
      uScale: { value: Number(context.config.scale) },
      uTurbulence: { value: Number(context.config.turbulence) },
      uFluidity: { value: Number(context.config.fluidity) },
      uRimWidth: { value: Number(context.config.rimWidth) },
      uSharpness: { value: Number(context.config.sharpness) },
      uShimmer: { value: Number(context.config.shimmer) },
      uGlow: { value: Number(context.config.glow) },
      uOpacity: { value: 1 },
      uMouseEnabled: { value: context.config.mouseInteraction ? 1 : 0 },
      uMouseStrength: { value: Number(context.config.mouseStrength) },
      uMouseRadius: { value: Number(context.config.mouseRadius) },
    };
    const program = new Program(gl, {
      vertex: ferrofluidVertexShader,
      fragment: ferrofluidFragmentShader,
      uniforms,
    });
    cleanupStack.push(() => {
      program.remove();
    });
    const geometry = new Triangle(gl);
    cleanupStack.push(() => {
      geometry.remove();
    });
    if (!gl.getProgramParameter(program.program, gl.LINK_STATUS)) {
      const detail =
        gl.getProgramInfoLog(program.program) || "unknown link error";
      throw new Error(`Ferrofluid shader program failed to link: ${detail}`);
    }
    const mesh = new Mesh(gl, { geometry, program });

    let frame = 0;
    let destroyed = false;
    let failed = false;
    let visible = context.visible;
    let reducedMotion = context.reducedMotion;
    let interaction = false;
    let lastTime = 0;
    let sizedWidth = -1;
    let sizedHeight = -1;
    let sizedDpr = -1;
    let dependencySnapshot = ferrofluidDependencySnapshot(
      context.config,
      context.palette.ink,
    );
    const mouseTarget = new Float32Array(FERROFLUID_INITIAL_MOUSE);
    cleanupStack.push(() => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    });

    function fail(error?: unknown) {
      if (destroyed || failed) return;
      failed = true;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      context.reportRuntimeFailure(error);
    }

    function resizeUnsafe() {
      const rect = context.host.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (
        rect.width !== sizedWidth ||
        rect.height !== sizedHeight ||
        dpr !== sizedDpr
      ) {
        renderer.dpr = dpr;
        renderer.setSize(rect.width, rect.height);
        uniforms.iResolution.value = [
          gl.drawingBufferWidth,
          gl.drawingBufferHeight,
          1,
        ];
        lastTime = performance.now();
        ensureFrame();
        sizedWidth = rect.width;
        sizedHeight = rect.height;
        sizedDpr = dpr;
      }
    }

    function resize() {
      if (destroyed || failed) return;
      try {
        resizeUnsafe();
      } catch (error) {
        fail(error);
      }
    }

    function resetMouse() {
      mouseTarget.set(FERROFLUID_INITIAL_MOUSE);
      uniforms.iMouse.value.set(FERROFLUID_INITIAL_MOUSE);
    }

    function pointerMove(event: PointerEvent) {
      if (!interaction || reducedMotion) {
        resetMouse();
        return;
      }
      const coordinates = ferrofluidPointerCoordinates(
        event.clientX,
        event.clientY,
        canvas.getBoundingClientRect(),
        renderer.dpr || 1,
      );
      if (!coordinates) resetMouse();
      else mouseTarget.set(coordinates);
      lastTime = performance.now();
      ensureFrame();
    }
    cleanupStack.push(() => {
      window.removeEventListener("pointermove", pointerMove);
    });

    function setInteraction(next: boolean) {
      if (next === interaction) {
        if (!next) resetMouse();
        return;
      }
      interaction = next;
      uniforms.uMouseEnabled.value = next ? 1 : 0;
      if (next)
        window.addEventListener("pointermove", pointerMove, { passive: true });
      else {
        window.removeEventListener("pointermove", pointerMove);
        resetMouse();
      }
    }

    function onContextLost(event: Event) {
      event.preventDefault();
      fail(new Error("Ferrofluid WebGL context was lost"));
    }
    cleanupStack.push(() => {
      canvas.removeEventListener("webglcontextlost", onContextLost);
    });
    canvas.addEventListener("webglcontextlost", onContextLost);

    function draw(time: number) {
      frame = 0;
      if (destroyed || failed || !visible) return;
      if (!reducedMotion) uniforms.iTime.value = time * 0.001;
      if (lastTime === 0) lastTime = time;
      if (interaction) {
        const factor = ferrofluidDampingFactor((time - lastTime) / 1000);
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
        if (ferrofluidMouseSettled(uniforms.iMouse.value, mouseTarget))
          uniforms.iMouse.value.set(mouseTarget);
      }
      lastTime = time;
      try {
        renderer.render({ scene: mesh });
        context.reportPaint?.();
      } catch (error) {
        fail(error);
        return;
      }
      if (
        shouldAnimateFerrofluid(
          uniforms.uSpeed.value,
          reducedMotion,
          interaction,
          uniforms.iMouse.value,
          mouseTarget,
        )
      )
        frame = requestAnimationFrame(draw);
    }

    function ensureFrame() {
      if (!destroyed && !failed && visible && frame === 0)
        frame = requestAnimationFrame(draw);
    }

    function updateUnsafe(next: BackgroundUpdateContext) {
      const resume =
        (!visible && next.visible) || (reducedMotion && !next.reducedMotion);
      const stateChanged =
        visible !== next.visible || reducedMotion !== next.reducedMotion;
      visible = next.visible;
      reducedMotion = next.reducedMotion;
      const config = next.config;
      const nextDependencySnapshot = ferrofluidDependencySnapshot(
        config,
        next.palette.ink,
      );
      const dependenciesChanged = nextDependencySnapshot !== dependencySnapshot;
      if (dependenciesChanged) {
        dependencySnapshot = nextDependencySnapshot;
        uniforms.iTime.value = 0;
        lastTime = 0;
        resetMouse();
      }
      uniforms.uFlow.value.set(
        ferrofluidFlowVector(String(config.flowDirection)),
      );
      uniforms.uSpeed.value = Number(config.speed);
      uniforms.uScale.value = Number(config.scale);
      uniforms.uTurbulence.value = Number(config.turbulence);
      uniforms.uFluidity.value = Number(config.fluidity);
      uniforms.uRimWidth.value = Number(config.rimWidth);
      uniforms.uSharpness.value = Number(config.sharpness);
      uniforms.uShimmer.value = Number(config.shimmer);
      uniforms.uGlow.value = Number(config.glow);
      uniforms.uMouseStrength.value = Number(config.mouseStrength);
      uniforms.uMouseRadius.value = Number(config.mouseRadius);
      for (const color of colors) color.set(next.palette.ink);
      average.set(next.palette.ink);
      setInteraction(
        Boolean(config.mouseInteraction) && visible && !reducedMotion,
      );
      if (resume) lastTime = performance.now();
      if (!visible && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      if (dependenciesChanged || stateChanged) ensureFrame();
    }

    function update(next: BackgroundUpdateContext) {
      if (destroyed || failed) return;
      try {
        updateUnsafe(next);
      } catch (error) {
        fail(error);
      }
    }

    context.host.replaceChildren(canvas);
    resizeUnsafe();
    updateUnsafe(context);
    return {
      resize,
      update,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        cleanupOwned();
      },
    };
  } catch (error) {
    cleanupOwned();
    throw error;
  }
}
