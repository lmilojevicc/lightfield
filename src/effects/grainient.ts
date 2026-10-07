// Adapted from React Bits Grainient.jsx at c7109dccb42e06592d1d9bc50bc87204697240e2.
// Copyright (c) 2026 David Haz. MIT + Commons Clause License Condition v1.0.
import { Mesh, Program, Renderer, Triangle } from "ogl";
import type {
  BackgroundContext,
  BackgroundInstance,
  BackgroundUpdateContext,
} from "./runtime/contracts";

const vertex = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

// The reversed-edge smoothstep in this shader is deliberately preserved byte-for-byte
// from the pinned source despite its cross-driver GLSL specification risk.
export const grainientFragmentShader = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform float uTimeSpeed;
uniform float uColorBalance;
uniform float uWarpStrength;
uniform float uWarpFrequency;
uniform float uWarpSpeed;
uniform float uWarpAmplitude;
uniform float uBlendAngle;
uniform float uBlendSoftness;
uniform float uRotationAmount;
uniform float uNoiseScale;
uniform float uGrainAmount;
uniform float uGrainScale;
uniform float uGrainAnimated;
uniform float uContrast;
uniform float uGamma;
uniform float uSaturation;
uniform vec2 uCenterOffset;
uniform float uZoom;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
out vec4 fragColor;
#define S(a,b,t) smoothstep(a,b,t)
mat2 Rot(float a){float s=sin(a),c=cos(a);return mat2(c,-s,s,c);}
vec2 hash(vec2 p){p=vec2(dot(p,vec2(2127.1,81.17)),dot(p,vec2(1269.5,283.37)));return fract(sin(p)*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);float n=mix(mix(dot(-1.0+2.0*hash(i+vec2(0.0,0.0)),f-vec2(0.0,0.0)),dot(-1.0+2.0*hash(i+vec2(1.0,0.0)),f-vec2(1.0,0.0)),u.x),mix(dot(-1.0+2.0*hash(i+vec2(0.0,1.0)),f-vec2(0.0,1.0)),dot(-1.0+2.0*hash(i+vec2(1.0,1.0)),f-vec2(1.0,1.0)),u.x),u.y);return 0.5+0.5*n;}
void mainImage(out vec4 o, vec2 C){
  float t=iTime*uTimeSpeed;
  vec2 uv=C/iResolution.xy;
  float ratio=iResolution.x/iResolution.y;
  vec2 tuv=uv-0.5+uCenterOffset;
  tuv/=max(uZoom,0.001);

  float degree=noise(vec2(t*0.1,tuv.x*tuv.y)*uNoiseScale);
  tuv.y*=1.0/ratio;
  tuv*=Rot(radians((degree-0.5)*uRotationAmount+180.0));
  tuv.y*=ratio;

  float frequency=uWarpFrequency;
  float ws=max(uWarpStrength,0.001);
  float amplitude=uWarpAmplitude/ws;
  float warpTime=t*uWarpSpeed;
  tuv.x+=sin(tuv.y*frequency+warpTime)/amplitude;
  tuv.y+=sin(tuv.x*(frequency*1.5)+warpTime)/(amplitude*0.5);

  vec3 colLav=uColor1;
  vec3 colOrg=uColor2;
  vec3 colDark=uColor3;
  float b=uColorBalance;
  float s=max(uBlendSoftness,0.0);
  mat2 blendRot=Rot(radians(uBlendAngle));
  float blendX=(tuv*blendRot).x;
  float edge0=-0.3-b-s;
  float edge1=0.2-b+s;
  float v0=0.5-b+s;
  float v1=-0.3-b-s;
  vec3 layer1=mix(colDark,colOrg,S(edge0,edge1,blendX));
  vec3 layer2=mix(colOrg,colLav,S(edge0,edge1,blendX));
  vec3 col=mix(layer1,layer2,S(v0,v1,tuv.y));

  vec2 grainUv=uv*max(uGrainScale,0.001);
  if(uGrainAnimated>0.5){grainUv+=vec2(iTime*0.05);}
  float grain=fract(sin(dot(grainUv,vec2(12.9898,78.233)))*43758.5453);
  col+=(grain-0.5)*uGrainAmount;

  col=(col-0.5)*uContrast+0.5;
  float luma=dot(col,vec3(0.2126,0.7152,0.0722));
  col=mix(vec3(luma),col,uSaturation);
  col=pow(max(col,0.0),vec3(1.0/max(uGamma,0.001)));
  col=clamp(col,0.0,1.0);

  o=vec4(col,1.0);
}
void main(){
  vec4 o=vec4(0.0);
  mainImage(o,gl_FragCoord.xy);
  fragColor=o;
}
`;

export function shouldAnimateGrainient(
  timeSpeed: number,
  grainAnimated: boolean,
  grainAmount: number,
  reducedMotion: boolean,
): boolean {
  return (
    !reducedMotion && (timeSpeed !== 0 || (grainAnimated && grainAmount !== 0))
  );
}

export function createGrainient(
  context: BackgroundContext,
): BackgroundInstance {
  const renderer = new Renderer({
    webgl: 2,
    alpha: true,
    antialias: false,
    dpr: Math.min(window.devicePixelRatio || 1, 2),
  });
  const gl = renderer.gl;
  const canvas = gl.canvas;
  if (!renderer.isWebgl2) {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    throw new Error(
      "Grainient requires WebGL2 because its pinned shaders use GLSL 300 ES",
    );
  }
  canvas.className = "background-canvas";
  const geometry = new Triangle(gl);
  const uniforms = {
    iTime: { value: 0 },
    iResolution: { value: new Float32Array([1, 1]) },
    uTimeSpeed: { value: 0.25 },
    uColorBalance: { value: 0 },
    uWarpStrength: { value: 1 },
    uWarpFrequency: { value: 5 },
    uWarpSpeed: { value: 2 },
    uWarpAmplitude: { value: 50 },
    uBlendAngle: { value: 0 },
    uBlendSoftness: { value: 0.05 },
    uRotationAmount: { value: 500 },
    uNoiseScale: { value: 2 },
    uGrainAmount: { value: 0.1 },
    uGrainScale: { value: 2 },
    uGrainAnimated: { value: 0 },
    uContrast: { value: 1.5 },
    uGamma: { value: 1 },
    uSaturation: { value: 1 },
    uCenterOffset: { value: new Float32Array([0, 0]) },
    uZoom: { value: 0.9 },
    // Official three-color semantic order: primary, secondary, deep base.
    uColor1: { value: new Float32Array(context.palette.accent) },
    uColor2: { value: new Float32Array(context.palette.focus) },
    uColor3: { value: new Float32Array(context.palette.ink) },
  };
  const program = new Program(gl, {
    vertex,
    fragment: grainientFragmentShader,
    uniforms,
  });
  if (!gl.getProgramParameter(program.program, gl.LINK_STATUS)) {
    const detail =
      gl.getProgramInfoLog(program.program) || "unknown link error";
    geometry.remove();
    program.remove();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    throw new Error(`Grainient shader program failed to link: ${detail}`);
  }
  const mesh = new Mesh(gl, { geometry, program });
  context.host.replaceChildren(canvas);

  let frame = 0;
  let destroyed = false;
  let failed = false;
  let visible = context.visible;
  let reducedMotion = context.reducedMotion;
  let timeSpeed = 0.25;
  let grainAnimated = false;
  let grainAmount = 0.1;
  let lastTime = 0;
  const startedAt = performance.now();
  let sizedWidth = -1;
  let sizedHeight = -1;
  let sizedDpr = -1;

  function fail(error?: unknown) {
    if (destroyed || failed) return;
    failed = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    context.reportRuntimeFailure(error);
  }
  function contextLost(event: Event) {
    event.preventDefault();
    fail(new Error("Grainient WebGL context was lost"));
  }
  canvas.addEventListener("webglcontextlost", contextLost);

  function draw(time: number) {
    frame = 0;
    if (destroyed || failed || !visible) return;
    if (!reducedMotion) lastTime = (time - startedAt) * 0.001;
    uniforms.iTime.value = lastTime;
    try {
      renderer.render({ scene: mesh });
      context.reportPaint?.();
    } catch (error) {
      fail(error);
      return;
    }
    if (
      shouldAnimateGrainient(
        timeSpeed,
        grainAnimated,
        grainAmount,
        reducedMotion,
      )
    )
      frame = requestAnimationFrame(draw);
  }
  function ensureFrame() {
    if (!destroyed && !failed && visible && frame === 0)
      frame = requestAnimationFrame(draw);
  }
  function resize() {
    const rect = context.host.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (width !== sizedWidth || height !== sizedHeight || dpr !== sizedDpr) {
      sizedWidth = width;
      sizedHeight = height;
      sizedDpr = dpr;
      renderer.dpr = dpr;
      renderer.setSize(width, height);
      uniforms.iResolution.value[0] = gl.drawingBufferWidth;
      uniforms.iResolution.value[1] = gl.drawingBufferHeight;
    }
    ensureFrame();
  }
  function update(next: BackgroundUpdateContext) {
    visible = next.visible;
    reducedMotion = next.reducedMotion;
    const config = next.config;
    timeSpeed = Number(config.timeSpeed);
    grainAnimated = Boolean(config.grainAnimated);
    grainAmount = Number(config.grainAmount);
    uniforms.uTimeSpeed.value = timeSpeed;
    uniforms.uColorBalance.value = Number(config.colorBalance);
    uniforms.uWarpStrength.value = Number(config.warpStrength);
    uniforms.uWarpFrequency.value = Number(config.warpFrequency);
    uniforms.uWarpSpeed.value = Number(config.warpSpeed);
    uniforms.uWarpAmplitude.value = Number(config.warpAmplitude);
    uniforms.uBlendAngle.value = Number(config.blendAngle);
    uniforms.uBlendSoftness.value = Number(config.blendSoftness);
    uniforms.uRotationAmount.value = Number(config.rotationAmount);
    uniforms.uNoiseScale.value = Number(config.noiseScale);
    uniforms.uGrainAmount.value = grainAmount;
    uniforms.uGrainScale.value = Number(config.grainScale);
    uniforms.uGrainAnimated.value = grainAnimated ? 1 : 0;
    uniforms.uContrast.value = Number(config.contrast);
    uniforms.uGamma.value = Number(config.gamma);
    uniforms.uSaturation.value = Number(config.saturation);
    uniforms.uCenterOffset.value[0] = Number(config.centerX);
    uniforms.uCenterOffset.value[1] = Number(config.centerY);
    uniforms.uZoom.value = Number(config.zoom);
    uniforms.uColor1.value.set(next.palette.accent);
    uniforms.uColor2.value.set(next.palette.focus);
    uniforms.uColor3.value.set(next.palette.ink);
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
      geometry.remove();
      program.remove();
      canvas.remove();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
