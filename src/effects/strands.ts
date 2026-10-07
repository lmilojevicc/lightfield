import { requiredValue } from "./runtime/required-value";
// Adapted from React Bits Strands.jsx at c7109dccb42e06592d1d9bc50bc87204697240e2.
// Copyright (c) 2026 David Haz. MIT + Commons Clause License Condition v1.0.
import { Mesh, Program, Renderer, RenderTarget, Triangle } from "ogl";
import type {
  BackgroundContext,
  BackgroundInstance,
  BackgroundUpdateContext,
} from "./runtime/contracts";

const MAX_STRANDS = 12;
const MAX_COLORS = 8;

const vertex = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const strandsFragmentShader = `#version 300 es
precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform vec3 uColors[${String(MAX_COLORS)}];
uniform int uColorCount;
uniform int uStrandCount;
uniform float uSpeed;
uniform float uAmplitude;
uniform float uWaviness;
uniform float uThickness;
uniform float uGlow;
uniform float uTaper;
uniform float uSpread;
uniform float uHueShift;
uniform float uIntensity;
uniform float uOpacity;
uniform float uScale;
uniform float uSaturation;

out vec4 fragColor;

const float PI = 3.14159265;

vec3 spectrum(float t) {
  return 0.5 + 0.5 * cos(2.0 * PI * (t + vec3(0.00, 0.33, 0.67)));
}

vec3 samplePalette(float t) {
  t = fract(t);
  float scaled = t * float(uColorCount);
  int idx = int(floor(scaled));
  float blend = fract(scaled);
  int nextIdx = idx + 1;
  if (nextIdx >= uColorCount) nextIdx = 0;
  return mix(uColors[idx], uColors[nextIdx], blend);
}

vec3 strandColor(float t) {
  if (uColorCount > 0) return samplePalette(t);
  return spectrum(t);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
  uv /= max(uScale, 0.0001);

  float e = 0.06 + uIntensity * 0.94;
  float env = pow(max(cos(uv.x * PI * 1.3), 0.0), uTaper);

  vec3 col = vec3(0.0);

  for (int i = 0; i < ${String(MAX_STRANDS)}; i++) {
    if (i >= uStrandCount) break;

    float fi = float(i);
    float ph = fi * 1.7 * uSpread;
    float freq = (2.0 + fi * 0.35) * uWaviness;
    float spd = 1.4 + fi * 1.2;

    float tt = uTime * uSpeed;
    float w = sin(uv.x * freq + tt * spd + ph) * 0.60
            + sin(uv.x * freq * 1.1 - tt * spd * 0.7 + ph * 1.7) * 0.40;

    float amp = (0.1 + 0.02 * e) * env * uAmplitude;
    float y = w * amp;

    float d = abs(uv.y - y);
    float thick = (0.001 + 0.05 * e) * (0.35 + env) * uThickness;
    float g = thick / (d + thick * 0.45);
    g = g * g;

    float h = fi / float(uStrandCount) + uv.x * 0.30 + uTime * 0.04 + uHueShift;
    col += strandColor(h) * g * env;
  }

  col *= 0.45 + 0.7 * e;
  col = 1.0 - exp(-col * uGlow);

  float gray = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(gray), col, uSaturation), 0.0);

  float lum = max(max(col.r, col.g), col.b);
  float alpha = clamp(lum, 0.0, 1.0) * uOpacity;

  fragColor = vec4(col * uOpacity, alpha);
}
`;

const strandsGlassFragmentShader = `#version 300 es
precision highp float;

uniform sampler2D uScene;
uniform vec2 uResolution;
uniform float uRadius;
uniform float uRefraction;
uniform float uDispersion;

out vec4 fragColor;

vec2 toUv(vec2 p) {
  return p * (uResolution.y / uResolution) + 0.5;
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
  float d = length(p);
  float r = uRadius;

  float edge = fwidth(d) * 1.5;
  float mask = 1.0 - smoothstep(r - edge, r + edge, d);
  if (mask <= 0.0) {
    fragColor = vec4(0.0);
    return;
  }

  // sphere height: 0 at the rim, 1 at the center
  float z = sqrt(max(r * r - d * d, 0.0)) / r;
  float nd = d / r; // 0 at the center, 1 at the rim

  // refraction is confined to a narrow band near the rim; the rest stays undistorted
  vec2 dir = d > 0.0 ? p / d : vec2(0.0);
  float lens = smoothstep(0.85, 1.0, nd) * pow(nd, 6.0);
  vec2 offset = -dir * lens * uRefraction * 0.15;
  vec2 disp = -dir * lens * uDispersion * 0.012;

  vec3 light;
  light.r = texture(uScene, toUv(p + offset - disp)).r;
  light.g = texture(uScene, toUv(p + offset)).g;
  light.b = texture(uScene, toUv(p + offset + disp)).b;

  // neutral fresnel rim (no color tint so the glass stays clear)
  float fres = pow(1.0 - z, 3.0);
  vec3 rim = vec3(1.0) * fres * 0.18;

  // specular highlight from the upper-left
  vec2 lightDir = normalize(vec2(-0.55, 0.6));
  float spec = pow(max(dot(p / max(r, 1e-4), lightDir), 0.0), 6.0);
  spec *= smoothstep(r, r * 0.55, d);

  vec3 emissive = light + rim + vec3(spec) * 0.4;
  float emissiveA = clamp(max(max(emissive.r, emissive.g), emissive.b), 0.0, 1.0);

  // almost clear glass body: only a faint neutral darkening, mostly near the rim
  float bodyA = 0.05 + fres * 0.05;

  // composite emissive light over the clear body (premultiplied)
  float outA = emissiveA + bodyA * (1.0 - emissiveA);
  vec3 outRGB = emissive;

  outRGB *= mask;
  outA *= mask;

  fragColor = vec4(outRGB, outA);
}
`;

export function strandsGlassRadius(glassSize: number): number {
  return 0.46 * glassSize;
}

function disposeStrandsRenderTarget(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  target: RenderTarget,
) {
  const attachments = target as Partial<
    Pick<
      RenderTarget,
      "depthTexture" | "depthBuffer" | "stencilBuffer" | "depthStencilBuffer"
    >
  >;
  for (const texture of target.textures) gl.deleteTexture(texture.texture);
  if (attachments.depthTexture)
    gl.deleteTexture(attachments.depthTexture.texture);
  if (attachments.depthBuffer) gl.deleteRenderbuffer(attachments.depthBuffer);
  if (attachments.stencilBuffer)
    gl.deleteRenderbuffer(attachments.stencilBuffer);
  if (attachments.depthStencilBuffer)
    gl.deleteRenderbuffer(attachments.depthStencilBuffer);
  gl.deleteFramebuffer(target.buffer);
}

export function createStrands(context: BackgroundContext): BackgroundInstance {
  const renderer = new Renderer({
    alpha: true,
    premultipliedAlpha: true,
    antialias: true,
  });
  const gl = renderer.gl;
  const canvas = gl.canvas;
  if (!renderer.isWebgl2) {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    throw new Error(
      "Strands requires WebGL2 because its pinned shaders use GLSL 300 ES",
    );
  }
  canvas.className = "background-canvas";
  canvas.style.backgroundColor = "transparent";
  gl.clearColor(0, 0, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const geometry = new Triangle(gl);
  if (geometry.attributes.uv) delete geometry.attributes.uv;
  const palette = [
    new Float32Array(context.palette.accent),
    new Float32Array(context.palette.focus),
    new Float32Array(context.palette.ink),
    ...Array.from({ length: 5 }, () => new Float32Array(context.palette.ink)),
  ];
  const uniforms = {
    uTime: { value: 0 },
    uResolution: {
      value: [context.host.offsetWidth, context.host.offsetHeight],
    },
    uColors: { value: palette },
    uColorCount: { value: 3 },
    uStrandCount: { value: 3 },
    uSpeed: { value: 0.5 },
    uAmplitude: { value: 1 },
    uWaviness: { value: 1 },
    uThickness: { value: 0.7 },
    uGlow: { value: 2.6 },
    uTaper: { value: 3 },
    uSpread: { value: 1 },
    uHueShift: { value: 0 },
    uIntensity: { value: 0.6 },
    uOpacity: { value: 1 },
    uScale: { value: 1.5 },
    uSaturation: { value: 2 },
  };
  const program = new Program(gl, {
    vertex,
    fragment: strandsFragmentShader,
    uniforms,
  });
  if (!gl.getProgramParameter(program.program, gl.LINK_STATUS)) {
    const detail =
      gl.getProgramInfoLog(program.program) || "unknown link error";
    geometry.remove();
    program.remove();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    throw new Error(`Strands shader program failed to link: ${detail}`);
  }
  const mesh = new Mesh(gl, { geometry, program });

  // The pinned renderer eagerly owns this full-size color/depth target and glass
  // program even while glass is off; toggles switch passes without reallocating.
  const renderTarget = new RenderTarget(gl, {
    width: Math.max(1, context.host.offsetWidth),
    height: Math.max(1, context.host.offsetHeight),
  });
  const glassUniforms = {
    uScene: { value: renderTarget.texture },
    uResolution: {
      value: [context.host.offsetWidth, context.host.offsetHeight],
    },
    uRadius: { value: strandsGlassRadius(1) },
    uRefraction: { value: 1 },
    uDispersion: { value: 1 },
  };
  const glassProgram = new Program(gl, {
    vertex,
    fragment: strandsGlassFragmentShader,
    uniforms: glassUniforms,
  });
  if (!gl.getProgramParameter(glassProgram.program, gl.LINK_STATUS)) {
    const detail =
      gl.getProgramInfoLog(glassProgram.program) || "unknown link error";
    glassProgram.remove();
    disposeStrandsRenderTarget(gl, renderTarget);
    geometry.remove();
    program.remove();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    throw new Error(`Strands glass shader program failed to link: ${detail}`);
  }
  const glassMesh = new Mesh(gl, { geometry, program: glassProgram });
  context.host.replaceChildren(canvas);

  let frame = 0;
  let destroyed = false;
  let failed = false;
  let visible = context.visible;
  let reducedMotion = context.reducedMotion;
  let glass = false;
  let lastTime = 0;
  let sizedWidth = -1;
  let sizedHeight = -1;

  function fail(error?: unknown) {
    if (destroyed || failed) return;
    failed = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    context.reportRuntimeFailure(error);
  }
  function contextLost(event: Event) {
    event.preventDefault();
    fail(new Error("Strands WebGL context was lost"));
  }
  canvas.addEventListener("webglcontextlost", contextLost);

  function draw(time: number) {
    frame = 0;
    if (destroyed || failed || !visible) return;
    if (!reducedMotion) lastTime = time * 0.001;
    uniforms.uTime.value = lastTime;
    try {
      if (glass) {
        renderer.render({ scene: mesh, target: renderTarget });
        glassUniforms.uScene.value = renderTarget.texture;
        renderer.render({ scene: glassMesh });
      } else {
        renderer.render({ scene: mesh });
      }
      context.reportPaint?.();
    } catch (error) {
      fail(error);
      return;
    }
    // Even speed=0 still animates the pinned palette phase through uTime*0.04.
    if (!reducedMotion) frame = requestAnimationFrame(draw);
  }
  function ensureFrame() {
    if (!destroyed && !failed && visible && frame === 0)
      frame = requestAnimationFrame(draw);
  }
  function resize() {
    const width = context.host.offsetWidth;
    const height = context.host.offsetHeight;
    if (width !== sizedWidth || height !== sizedHeight) {
      sizedWidth = width;
      sizedHeight = height;
      renderer.dpr = 1;
      renderer.setSize(width, height);
      uniforms.uResolution.value = [width, height];
      renderTarget.setSize(Math.max(1, width), Math.max(1, height));
      glassUniforms.uResolution.value = [width, height];
    }
    ensureFrame();
  }
  function update(next: BackgroundUpdateContext) {
    visible = next.visible;
    reducedMotion = next.reducedMotion;
    const config = next.config;
    requiredValue(palette[0]).set(next.palette.accent);
    requiredValue(palette[1]).set(next.palette.focus);
    for (let index = 2; index < palette.length; index++)
      requiredValue(palette[index]).set(next.palette.ink);
    uniforms.uStrandCount.value = Math.min(
      Math.max(Math.round(Number(config.count)), 1),
      MAX_STRANDS,
    );
    uniforms.uSpeed.value = Number(config.speed);
    uniforms.uAmplitude.value = Number(config.amplitude);
    uniforms.uWaviness.value = Number(config.waviness);
    uniforms.uThickness.value = Number(config.thickness);
    uniforms.uGlow.value = Number(config.glow);
    uniforms.uTaper.value = Number(config.taper);
    uniforms.uSpread.value = Number(config.spread);
    uniforms.uHueShift.value = Number(config.hueShift);
    uniforms.uIntensity.value = Number(config.intensity);
    uniforms.uOpacity.value = Number(config.opacity);
    uniforms.uScale.value = Number(config.scale);
    uniforms.uSaturation.value = Number(config.saturation);
    glass = Boolean(config.glass);
    glassUniforms.uRefraction.value = Number(config.refraction);
    glassUniforms.uDispersion.value = Number(config.dispersion);
    glassUniforms.uRadius.value = strandsGlassRadius(Number(config.glassSize));
    if (!visible && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    ensureFrame();
  }

  update(context);
  resize();
  return {
    update,
    resize,
    destroy() {
      destroyed = true;
      if (frame) cancelAnimationFrame(frame);
      canvas.removeEventListener("webglcontextlost", contextLost);
      glassProgram.remove();
      program.remove();
      geometry.remove();
      disposeStrandsRenderTarget(gl, renderTarget);
      canvas.remove();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
