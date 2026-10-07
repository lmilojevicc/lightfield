// Adapted from React Bits SideRays.jsx at
// c7109dccb42e06592d1d9bc50bc87204697240e2.
// Copyright (c) 2026 David Haz. MIT + Commons Clause License Condition v1.0.
import { Mesh, Program, Renderer, Triangle } from "ogl";
import type {
  BackgroundContext,
  BackgroundInstance,
} from "./runtime/contracts";

const vertex = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const fragment = `precision highp float;
uniform float iTime;
uniform vec2 iResolution;
uniform float iSpeed;
uniform vec3 iRayColor1;
uniform vec3 iRayColor2;
uniform float iIntensity;
uniform float iSpread;
uniform float iFlipX;
uniform float iFlipY;
uniform float iTilt;
uniform float iSaturation;
uniform float iBlend;
uniform float iFalloff;
uniform float iOpacity;
float rayStrength(vec2 raySource, vec2 rayRefDirection, vec2 coord, float seedA, float seedB, float speed) {
  vec2 sourceToCoord = coord - raySource;
  float cosAngle = dot(normalize(sourceToCoord), rayRefDirection);
  return clamp(
    (0.45 + 0.15 * sin(cosAngle * seedA + iTime * speed)) +
    (0.3 + 0.2 * cos(-cosAngle * seedB + iTime * speed)),
    0.0, 1.0) *
    clamp((iResolution.x - length(sourceToCoord)) / iResolution.x, 0.5, 1.0);
}
void main() {
  vec2 fragCoord = gl_FragCoord.xy;
  if (iFlipX > 0.5) fragCoord.x = iResolution.x - fragCoord.x;
  if (iFlipY > 0.5) fragCoord.y = iResolution.y - fragCoord.y;
  vec2 coord = vec2(fragCoord.x, iResolution.y - fragCoord.y);
  vec2 rayPos = vec2(iResolution.x * 1.1, -0.5 * iResolution.y);
  float tiltRad = iTilt * 3.14159265 / 180.0;
  float cs = cos(tiltRad);
  float sn = sin(tiltRad);
  vec2 rel = coord - rayPos;
  vec2 tiltedCoord = vec2(rel.x * cs - rel.y * sn, rel.x * sn + rel.y * cs) + rayPos;
  float halfSpread = iSpread * 0.275;
  vec2 rayRefDir1 = normalize(vec2(cos(0.785398 + halfSpread), sin(0.785398 + halfSpread)));
  vec2 rayRefDir2 = normalize(vec2(cos(0.785398 - halfSpread), sin(0.785398 - halfSpread)));
  vec4 rays1 = vec4(iRayColor1, 1.0) * rayStrength(rayPos, rayRefDir1, tiltedCoord, 36.2214, 21.11349, iSpeed);
  vec4 rays2 = vec4(iRayColor2, 1.0) * rayStrength(rayPos, rayRefDir2, tiltedCoord, 22.3991, 18.0234, iSpeed * 0.2);
  vec4 color = rays1 * (1.0 - iBlend) * 0.9 + rays2 * iBlend * 0.9;
  float distanceToLight = length(fragCoord.xy - vec2(rayPos.x, iResolution.y - rayPos.y)) / iResolution.y;
  float brightness = iIntensity * 0.4 / pow(max(distanceToLight, 0.001), iFalloff);
  color.rgb *= brightness;
  float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  color.rgb = mix(vec3(gray), color.rgb, iSaturation);
  color.a = max(color.r, max(color.g, color.b)) * iOpacity;
  gl_FragColor = color;
}`;

function originToFlip(origin: string): [number, number] {
  if (origin === "top-left") return [1, 0];
  if (origin === "bottom-right") return [0, 1];
  if (origin === "bottom-left") return [1, 1];
  return [0, 0];
}

export function createSideRays(context: BackgroundContext): BackgroundInstance {
  const renderer = new Renderer({
    dpr: Math.min(window.devicePixelRatio, 2),
    alpha: true,
  });
  const gl = renderer.gl;
  const canvas = gl.canvas;
  canvas.className = "background-canvas";
  context.host.replaceChildren(canvas);

  const uniforms = {
    iTime: { value: 0 },
    iResolution: { value: [1, 1] },
    iSpeed: { value: 2.5 },
    iRayColor1: { value: context.palette.accent },
    iRayColor2: { value: context.palette.focus },
    iIntensity: { value: 2 },
    iSpread: { value: 2 },
    iFlipX: { value: 0 },
    iFlipY: { value: 0 },
    iTilt: { value: 0 },
    iSaturation: { value: 1.5 },
    iBlend: { value: 0.75 },
    iFalloff: { value: 1.6 },
    iOpacity: { value: 1 },
  };
  const geometry = new Triangle(gl);
  const program = new Program(gl, { vertex, fragment, uniforms });
  const mesh = new Mesh(gl, { geometry, program });
  let frame = 0;
  let destroyed = false;
  let failed = false;
  let visible = context.visible;
  let reducedMotion = context.reducedMotion;
  let lastTime = 0;

  function fail(error?: unknown) {
    if (destroyed || failed) return;
    failed = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    context.reportRuntimeFailure(error);
  }

  function onContextLost(event: Event) {
    event.preventDefault();
    fail(new Error("Side Rays WebGL context was lost"));
  }

  function resize() {
    if (destroyed || failed) return;
    renderer.dpr = Math.min(window.devicePixelRatio, 2);
    const width = context.host.clientWidth;
    const height = context.host.clientHeight;
    renderer.setSize(width, height);
    uniforms.iResolution.value = [width * renderer.dpr, height * renderer.dpr];
    ensureFrame();
  }

  function draw(time: number) {
    frame = 0;
    if (destroyed || failed || !visible) return;
    uniforms.iTime.value = reducedMotion ? lastTime : time * 0.001;
    lastTime = uniforms.iTime.value;
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

  function update(next: Omit<BackgroundContext, "host">) {
    if (destroyed || failed) return;
    visible = next.visible;
    reducedMotion = next.reducedMotion;
    const config = next.config;
    uniforms.iSpeed.value = Number(config.speed);
    uniforms.iRayColor1.value = next.palette.accent;
    uniforms.iRayColor2.value = next.palette.focus;
    uniforms.iIntensity.value = Number(config.intensity);
    uniforms.iSpread.value = Number(config.spread);
    const [flipX, flipY] = originToFlip(String(config.origin));
    uniforms.iFlipX.value = flipX;
    uniforms.iFlipY.value = flipY;
    uniforms.iTilt.value = Number(config.tilt);
    uniforms.iSaturation.value = Number(config.saturation);
    uniforms.iBlend.value = Number(config.blend);
    uniforms.iFalloff.value = Number(config.falloff);
    uniforms.iOpacity.value = Number(config.opacity);
    if (!visible && frame !== 0) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    ensureFrame();
  }

  canvas.addEventListener("webglcontextlost", onContextLost);
  resize();
  update(context);

  return {
    update,
    resize,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = 0;
      canvas.removeEventListener("webglcontextlost", onContextLost);
      geometry.remove();
      program.remove();
      canvas.remove();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
