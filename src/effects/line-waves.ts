import { requiredValue } from "./runtime/required-value";
// Adapted from React Bits src/content/Backgrounds/LineWaves/LineWaves.jsx
// at 4022efa12a8763a2aeb10768ad0b390d30b6d960. See THIRD_PARTY_NOTICES.md.
import { Mesh, Program, Renderer, Triangle } from "ogl";
import type {
  BackgroundContext,
  BackgroundInstance,
  BackgroundUpdateContext,
} from "./runtime/contracts";

export const LINE_WAVES_INITIAL_MOUSE: readonly [number, number] = [0.5, 0.5];

export const lineWavesVertexShader = `
attribute vec2 uv;
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0, 1);
}
`;

export const lineWavesFragmentShader = `
precision highp float;

uniform float uTime;
uniform vec3 uResolution;
uniform float uSpeed;
uniform float uInnerLines;
uniform float uOuterLines;
uniform float uWarpIntensity;
uniform float uRotation;
uniform float uEdgeFadeWidth;
uniform float uColorCycleSpeed;
uniform float uBrightness;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform vec2 uMouse;
uniform float uMouseInfluence;
uniform bool uEnableMouse;

#define HALF_PI 1.5707963

float hashF(float n) {
  return fract(sin(n * 127.1) * 43758.5453123);
}

float smoothNoise(float x) {
  float i = floor(x);
  float f = fract(x);
  float u = f * f * (3.0 - 2.0 * f);
  return mix(hashF(i), hashF(i + 1.0), u);
}

float displaceA(float coord, float t) {
  float result = sin(coord * 2.123) * 0.2;
  result += sin(coord * 3.234 + t * 4.345) * 0.1;
  result += sin(coord * 0.589 + t * 0.934) * 0.5;
  return result;
}

float displaceB(float coord, float t) {
  float result = sin(coord * 1.345) * 0.3;
  result += sin(coord * 2.734 + t * 3.345) * 0.2;
  result += sin(coord * 0.189 + t * 0.934) * 0.3;
  return result;
}

vec2 rotate2D(vec2 p, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}

void main() {
  vec2 coords = gl_FragCoord.xy / uResolution.xy;
  coords = coords * 2.0 - 1.0;
  coords = rotate2D(coords, uRotation);

  float halfT = uTime * uSpeed * 0.5;
  float fullT = uTime * uSpeed;

  float mouseWarp = 0.0;
  if (uEnableMouse) {
    vec2 mPos = rotate2D(uMouse * 2.0 - 1.0, uRotation);
    float mDist = length(coords - mPos);
    mouseWarp = uMouseInfluence * exp(-mDist * mDist * 4.0);
  }

  float warpAx = coords.x + displaceA(coords.y, halfT) * uWarpIntensity + mouseWarp;
  float warpAy = coords.y - displaceA(coords.x * cos(fullT) * 1.235, halfT) * uWarpIntensity;
  float warpBx = coords.x + displaceB(coords.y, halfT) * uWarpIntensity + mouseWarp;
  float warpBy = coords.y - displaceB(coords.x * sin(fullT) * 1.235, halfT) * uWarpIntensity;

  vec2 fieldA = vec2(warpAx, warpAy);
  vec2 fieldB = vec2(warpBx, warpBy);
  vec2 blended = mix(fieldA, fieldB, mix(fieldA, fieldB, 0.5));

  float fadeTop = smoothstep(uEdgeFadeWidth, uEdgeFadeWidth + 0.4, blended.y);
  float fadeBottom = smoothstep(-uEdgeFadeWidth, -(uEdgeFadeWidth + 0.4), blended.y);
  float vMask = 1.0 - max(fadeTop, fadeBottom);

  float tileCount = mix(uOuterLines, uInnerLines, vMask);
  float scaledY = blended.y * tileCount;
  float nY = smoothNoise(abs(scaledY));

  float ridge = pow(
    step(abs(nY - blended.x) * 2.0, HALF_PI) * cos(2.0 * (nY - blended.x)),
    5.0
  );

  float lines = 0.0;
  for (float i = 1.0; i < 3.0; i += 1.0) {
    lines += pow(max(fract(scaledY), fract(-scaledY)), i * 2.0);
  }

  float pattern = vMask * lines;

  float cycleT = fullT * uColorCycleSpeed;
  float rChannel = (pattern + lines * ridge) * (cos(blended.y + cycleT * 0.234) * 0.5 + 1.0);
  float gChannel = (pattern + vMask * ridge) * (sin(blended.x + cycleT * 1.745) * 0.5 + 1.0);
  float bChannel = (pattern + lines * ridge) * (cos(blended.x + cycleT * 0.534) * 0.5 + 1.0);

  vec3 col = (rChannel * uColor1 + gChannel * uColor2 + bChannel * uColor3) * uBrightness;
  float alpha = clamp(length(col), 0.0, 1.0);

  gl_FragColor = vec4(col, alpha);
}
`;

export function lineWavesRotationRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function stepLineWavesMouse(
  current: readonly [number, number],
  target: readonly [number, number],
): [number, number] {
  return [
    current[0] + 0.05 * (target[0] - current[0]),
    current[1] + 0.05 * (target[1] - current[1]),
  ];
}

export function lineWavesPointerCoordinates(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, "left" | "top" | "width" | "height">,
): [number, number] | null {
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
    (clientX - rect.left) / rect.width,
    1 - (clientY - rect.top) / rect.height,
  ];
}

export function lineWavesDependencySnapshot(
  config: Record<string, unknown>,
  ink: readonly number[],
): string {
  return JSON.stringify([
    Number(config.speed),
    Number(config.innerLineCount),
    Number(config.outerLineCount),
    Number(config.warpIntensity),
    Number(config.rotation),
    Number(config.edgeFadeWidth),
    Number(config.colorCycleSpeed),
    Number(config.brightness),
    Boolean(config.enableMouseInteraction),
    Number(config.mouseInfluence),
    ink[0],
    ink[1],
    ink[2],
  ]);
}

export function createLineWaves(
  context: BackgroundContext,
): BackgroundInstance {
  const renderer = new Renderer({ alpha: true, premultipliedAlpha: false });
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

    const ink = new Float32Array(context.palette.ink);
    const uniforms = {
      uTime: { value: 0 },
      uResolution: {
        value: [canvas.width, canvas.height, canvas.width / canvas.height],
      },
      uSpeed: { value: Number(context.config.speed) },
      uInnerLines: { value: Number(context.config.innerLineCount) },
      uOuterLines: { value: Number(context.config.outerLineCount) },
      uWarpIntensity: { value: Number(context.config.warpIntensity) },
      uRotation: {
        value: lineWavesRotationRadians(Number(context.config.rotation)),
      },
      uEdgeFadeWidth: { value: Number(context.config.edgeFadeWidth) },
      uColorCycleSpeed: { value: Number(context.config.colorCycleSpeed) },
      uBrightness: { value: Number(context.config.brightness) },
      uColor1: { value: ink },
      uColor2: { value: ink },
      uColor3: { value: ink },
      uMouse: { value: new Float32Array(LINE_WAVES_INITIAL_MOUSE) },
      uMouseInfluence: { value: Number(context.config.mouseInfluence) },
      uEnableMouse: { value: Boolean(context.config.enableMouseInteraction) },
    };
    const geometry = new Triangle(gl);
    cleanupStack.push(() => {
      geometry.remove();
    });
    const program = new Program(gl, {
      vertex: lineWavesVertexShader,
      fragment: lineWavesFragmentShader,
      uniforms,
    });
    cleanupStack.push(() => {
      program.remove();
    });
    if (!gl.getProgramParameter(program.program, gl.LINK_STATUS)) {
      const detail =
        gl.getProgramInfoLog(program.program) || "unknown link error";
      throw new Error(`Line Waves shader program failed to link: ${detail}`);
    }
    const mesh = new Mesh(gl, { geometry, program });

    let frame = 0;
    let destroyed = false;
    let failed = false;
    let visible = context.visible;
    let reducedMotion = context.reducedMotion;
    let interaction = false;
    let currentMouse: [number, number] = [...LINE_WAVES_INITIAL_MOUSE];
    let targetMouse: [number, number] = [...LINE_WAVES_INITIAL_MOUSE];
    let lastTime = 0;
    let dependencySnapshot = lineWavesDependencySnapshot(
      context.config,
      context.palette.ink,
    );
    let sizedWidth = -1;
    let sizedHeight = -1;
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
      const width = context.host.offsetWidth;
      const height = context.host.offsetHeight;
      if (width !== sizedWidth || height !== sizedHeight) {
        renderer.setSize(width, height);
        uniforms.uResolution.value = [
          canvas.width,
          canvas.height,
          height === 0 ? 1 : canvas.width / canvas.height,
        ];
        sizedWidth = width;
        sizedHeight = height;
      }
      ensureFrame();
    }

    function resize() {
      if (destroyed || failed) return;
      try {
        resizeUnsafe();
      } catch (error) {
        fail(error);
      }
    }

    function resetMouse(resetCurrent: boolean) {
      targetMouse = [...LINE_WAVES_INITIAL_MOUSE];
      if (resetCurrent) {
        currentMouse = [...LINE_WAVES_INITIAL_MOUSE];
        uniforms.uMouse.value.set(LINE_WAVES_INITIAL_MOUSE);
      }
    }

    function pointerMove(event: PointerEvent) {
      if (!interaction || reducedMotion) {
        resetMouse(true);
        return;
      }
      const coordinates = lineWavesPointerCoordinates(
        event.clientX,
        event.clientY,
        canvas.getBoundingClientRect(),
      );
      if (!coordinates) resetMouse(false);
      else targetMouse = coordinates;
      ensureFrame();
    }
    cleanupStack.push(() => {
      window.removeEventListener("pointermove", pointerMove);
    });

    function setInteraction(next: boolean) {
      if (next === interaction) {
        if (!next) resetMouse(true);
        return;
      }
      interaction = next;
      uniforms.uEnableMouse.value = next;
      if (next)
        window.addEventListener("pointermove", pointerMove, { passive: true });
      else {
        window.removeEventListener("pointermove", pointerMove);
        resetMouse(true);
      }
    }

    function onContextLost(event: Event) {
      event.preventDefault();
      fail(new Error("Line Waves WebGL context was lost"));
    }
    cleanupStack.push(() => {
      canvas.removeEventListener("webglcontextlost", onContextLost);
    });
    canvas.addEventListener("webglcontextlost", onContextLost);

    function draw(time: number) {
      frame = 0;
      if (destroyed || failed || !visible) return;
      if (!reducedMotion) lastTime = time * 0.001;
      uniforms.uTime.value = lastTime;
      if (interaction) {
        currentMouse = stepLineWavesMouse(currentMouse, targetMouse);
        uniforms.uMouse.value.set(currentMouse);
      } else {
        uniforms.uMouse.value.set(LINE_WAVES_INITIAL_MOUSE);
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
      if (!destroyed && !failed && visible && frame === 0)
        frame = requestAnimationFrame(draw);
    }

    function updateUnsafe(next: BackgroundUpdateContext) {
      const becameVisible = !visible && next.visible;
      visible = next.visible;
      reducedMotion = next.reducedMotion;
      const config = next.config;
      const nextDependencySnapshot = lineWavesDependencySnapshot(
        config,
        next.palette.ink,
      );
      if (nextDependencySnapshot !== dependencySnapshot) {
        dependencySnapshot = nextDependencySnapshot;
        lastTime = 0;
        uniforms.uTime.value = 0;
        resetMouse(true);
      }
      uniforms.uSpeed.value = Number(config.speed);
      uniforms.uInnerLines.value = Number(config.innerLineCount);
      uniforms.uOuterLines.value = Number(config.outerLineCount);
      uniforms.uWarpIntensity.value = Number(config.warpIntensity);
      uniforms.uRotation.value = lineWavesRotationRadians(
        Number(config.rotation),
      );
      uniforms.uEdgeFadeWidth.value = Number(config.edgeFadeWidth);
      uniforms.uColorCycleSpeed.value = Number(config.colorCycleSpeed);
      uniforms.uBrightness.value = Number(config.brightness);
      uniforms.uMouseInfluence.value = Number(config.mouseInfluence);
      ink.set(next.palette.ink);
      setInteraction(
        Boolean(config.enableMouseInteraction) && visible && !reducedMotion,
      );
      if (!visible && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      if (becameVisible) lastTime = performance.now() * 0.001;
      ensureFrame();
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
