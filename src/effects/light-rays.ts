import { requiredValue } from "./runtime/required-value";
// Adapted from React Bits LightRays.jsx at c7109dccb42e06592d1d9bc50bc87204697240e2.
// Copyright (c) 2026 David Haz. MIT + Commons Clause License Condition v1.0.
import { Renderer, Program, Triangle, Mesh } from "ogl";
import type {
  BackgroundContext,
  BackgroundInstance,
  BackgroundUpdateContext,
} from "./runtime/contracts";
const vertex = `
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;
const fragment = `precision highp float;

uniform float iTime;
uniform vec2  iResolution;

uniform vec2  rayPos;
uniform vec2  rayDir;
uniform vec3  raysColor;
uniform float raysSpeed;
uniform float lightSpread;
uniform float rayLength;
uniform float pulsating;
uniform float fadeDistance;
uniform float saturation;
uniform vec2  mousePos;
uniform float mouseInfluence;
uniform float noiseAmount;
uniform float distortion;

varying vec2 vUv;

float noise(vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}

float rayStrength(vec2 raySource, vec2 rayRefDirection, vec2 coord,
                  float seedA, float seedB, float speed) {
  vec2 sourceToCoord = coord - raySource;
  vec2 dirNorm = normalize(sourceToCoord);
  float cosAngle = dot(dirNorm, rayRefDirection);

  float distortedAngle = cosAngle + distortion * sin(iTime * 2.0 + length(sourceToCoord) * 0.01) * 0.2;

  float spreadFactor = pow(max(distortedAngle, 0.0), 1.0 / max(lightSpread, 0.001));

  float distance = length(sourceToCoord);
  float maxDistance = iResolution.x * rayLength;
  float lengthFalloff = clamp((maxDistance - distance) / maxDistance, 0.0, 1.0);

  float fadeFalloff = clamp((iResolution.x * fadeDistance - distance) / (iResolution.x * fadeDistance), 0.5, 1.0);
  float pulse = pulsating > 0.5 ? (0.8 + 0.2 * sin(iTime * speed * 3.0)) : 1.0;

  float baseStrength = clamp(
    (0.45 + 0.15 * sin(distortedAngle * seedA + iTime * speed)) +
    (0.3 + 0.2 * cos(-distortedAngle * seedB + iTime * speed)),
    0.0, 1.0
  );

  return baseStrength * lengthFalloff * fadeFalloff * spreadFactor * pulse;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = vec2(fragCoord.x, iResolution.y - fragCoord.y);

  vec2 finalRayDir = rayDir;
  if (mouseInfluence > 0.0) {
    vec2 mouseScreenPos = mousePos * iResolution.xy;
    vec2 mouseDirection = normalize(mouseScreenPos - rayPos);
    finalRayDir = normalize(mix(rayDir, mouseDirection, mouseInfluence));
  }

  vec4 rays1 = vec4(1.0) *
               rayStrength(rayPos, finalRayDir, coord, 36.2214, 21.11349,
                           1.5 * raysSpeed);
  vec4 rays2 = vec4(1.0) *
               rayStrength(rayPos, finalRayDir, coord, 22.3991, 18.0234,
                           1.1 * raysSpeed);

  fragColor = rays1 * 0.5 + rays2 * 0.4;

  if (noiseAmount > 0.0) {
    float n = noise(coord * 0.01 + iTime * 0.1);
    fragColor.rgb *= (1.0 - noiseAmount + noiseAmount * n);
  }

  float brightness = 1.0 - (coord.y / iResolution.y);
  fragColor.x *= 0.1 + brightness * 0.8;
  fragColor.y *= 0.3 + brightness * 0.6;
  fragColor.z *= 0.5 + brightness * 0.5;

  if (saturation != 1.0) {
    float gray = dot(fragColor.rgb, vec3(0.299, 0.587, 0.114));
    fragColor.rgb = mix(vec3(gray), fragColor.rgb, saturation);
  }

  fragColor.rgb *= raysColor;
}

void main() {
  vec4 color;
  mainImage(color, gl_FragCoord.xy);
  gl_FragColor  = color;
}`;
export function lightRaysAnchor(
  origin: string,
  w: number,
  h: number,
): { anchor: [number, number]; dir: [number, number] } {
  const outside = 0.2;
  switch (origin) {
    case "left":
      return { anchor: [-outside * w, 0.5 * h], dir: [1, 0] };
    case "right":
      return { anchor: [(1 + outside) * w, 0.5 * h], dir: [-1, 0] };
    case "bottom-center":
      return { anchor: [0.5 * w, (1 + outside) * h], dir: [0, -1] };
    default:
      return { anchor: [0.5 * w, -outside * h], dir: [0, 1] };
  }
}
export function createLightRays(
  context: BackgroundContext,
): BackgroundInstance {
  const renderer = new Renderer({
      dpr: Math.min(devicePixelRatio, 2),
      alpha: true,
    }),
    gl = renderer.gl,
    canvas = gl.canvas;
  canvas.className = "background-canvas";
  context.host.replaceChildren(canvas);
  const uniforms = {
    iTime: { value: 0 },
    iResolution: { value: [1, 1] },
    rayPos: { value: [0, 0] },
    rayDir: { value: [0, 1] },
    raysColor: { value: context.palette.ink },
    raysSpeed: { value: 1 },
    lightSpread: { value: 0.5 },
    rayLength: { value: 3 },
    pulsating: { value: 0 },
    fadeDistance: { value: 1 },
    saturation: { value: 1 },
    mousePos: { value: [0.5, 0.5] },
    mouseInfluence: { value: 0.1 },
    noiseAmount: { value: 0 },
    distortion: { value: 0 },
  };
  const geometry = new Triangle(gl),
    program = new Program(gl, { vertex, fragment, uniforms }),
    mesh = new Mesh(gl, { geometry, program });
  let frame = 0,
    destroyed = false,
    failed = false,
    visible = context.visible,
    reduced = context.reducedMotion,
    lastTime = 0,
    origin = "top-center",
    sizedWidth = -1,
    sizedHeight = -1,
    sizedDpr = -1,
    mouse = { x: 0.5, y: 0.5 };
  const smooth = { x: 0.5, y: 0.5 };
  function fail(error?: unknown) {
    if (failed || destroyed) return;
    failed = true;
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    context.reportRuntimeFailure(error);
  }
  function place() {
    const w = requiredValue(uniforms.iResolution.value[0]),
      h = requiredValue(uniforms.iResolution.value[1]);
    const next = lightRaysAnchor(origin, w, h);
    uniforms.rayPos.value = next.anchor;
    uniforms.rayDir.value = next.dir;
  }
  function resize() {
    const width = context.host.clientWidth,
      height = context.host.clientHeight,
      dpr = Math.min(devicePixelRatio || 1, 2);
    if (width !== sizedWidth || height !== sizedHeight || dpr !== sizedDpr) {
      sizedWidth = width;
      sizedHeight = height;
      sizedDpr = dpr;
      renderer.dpr = dpr;
      renderer.setSize(width, height);
      uniforms.iResolution.value = [canvas.width, canvas.height];
      place();
    }
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
    )
      return;
    mouse = {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
    ensure();
  }
  function contextLost() {
    fail(new Error("Light Rays WebGL context was lost"));
  }
  window.addEventListener("pointermove", move, { passive: true });
  canvas.addEventListener("webglcontextlost", contextLost);
  function draw(t: number) {
    frame = 0;
    if (destroyed || failed || !visible) return;
    lastTime = reduced ? lastTime : t * 0.001;
    uniforms.iTime.value = lastTime;
    smooth.x = smooth.x * 0.92 + mouse.x * 0.08;
    smooth.y = smooth.y * 0.92 + mouse.y * 0.08;
    uniforms.mousePos.value = [smooth.x, smooth.y];
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
    const nextOrigin = String(next.config.raysOrigin),
      originChanged = nextOrigin !== origin;
    origin = nextOrigin;
    uniforms.raysColor.value = next.palette.ink;
    uniforms.raysSpeed.value = Number(next.config.raysSpeed);
    uniforms.lightSpread.value = Number(next.config.lightSpread);
    uniforms.rayLength.value = Number(next.config.rayLength);
    uniforms.pulsating.value = next.config.pulsating ? 1 : 0;
    uniforms.fadeDistance.value = Number(next.config.fadeDistance);
    uniforms.saturation.value = Number(next.config.saturation);
    uniforms.mouseInfluence.value = Number(next.config.mouseInfluence);
    uniforms.noiseAmount.value = Number(next.config.noiseAmount);
    uniforms.distortion.value = Number(next.config.distortion);
    if (originChanged) place();
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
