import { requiredValue } from "./runtime/required-value";
// Direct Three.js/postprocessing port of React Bits Dither.jsx at
// c7109dccb42e06592d1d9bc50bc87204697240e2.
// Copyright (c) 2026 David Haz. MIT + Commons Clause License Condition v1.0.
import * as THREE from "three";
import { Effect, EffectComposer, EffectPass, RenderPass } from "postprocessing";
import { ditherElapsedTime } from "./dither-timing";
import { assertThreePrograms } from "./three-runtime";
import type {
  BackgroundContext,
  BackgroundInstance,
} from "./runtime/contracts";

const waveVertexShader = `
precision highp float;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 modelPosition = modelMatrix * vec4(position, 1.0);
  vec4 viewPosition = viewMatrix * modelPosition;
  gl_Position = projectionMatrix * viewPosition;
}`;

const waveFragmentShader = `
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform float waveSpeed;
uniform float waveFrequency;
uniform float waveAmplitude;
uniform vec3 waveColor;
uniform vec3 baseColor;
uniform vec2 mousePos;
uniform int enableMouseInteraction;
uniform float mouseRadius;
vec4 mod289(vec4 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
vec2 fade(vec2 t) { return t*t*t*(t*(t*6.0-15.0)+10.0); }
float cnoise(vec2 P) {
  vec4 Pi = floor(P.xyxy) + vec4(0.0,0.0,1.0,1.0);
  vec4 Pf = fract(P.xyxy) - vec4(0.0,0.0,1.0,1.0);
  Pi = mod289(Pi);
  vec4 ix = Pi.xzxz;
  vec4 iy = Pi.yyww;
  vec4 fx = Pf.xzxz;
  vec4 fy = Pf.yyww;
  vec4 i = permute(permute(ix) + iy);
  vec4 gx = fract(i * (1.0/41.0)) * 2.0 - 1.0;
  vec4 gy = abs(gx) - 0.5;
  vec4 tx = floor(gx + 0.5);
  gx = gx - tx;
  vec2 g00 = vec2(gx.x, gy.x);
  vec2 g10 = vec2(gx.y, gy.y);
  vec2 g01 = vec2(gx.z, gy.z);
  vec2 g11 = vec2(gx.w, gy.w);
  vec4 norm = taylorInvSqrt(vec4(dot(g00,g00), dot(g01,g01), dot(g10,g10), dot(g11,g11)));
  g00 *= norm.x; g01 *= norm.y; g10 *= norm.z; g11 *= norm.w;
  float n00 = dot(g00, vec2(fx.x, fy.x));
  float n10 = dot(g10, vec2(fx.y, fy.y));
  float n01 = dot(g01, vec2(fx.z, fy.z));
  float n11 = dot(g11, vec2(fx.w, fy.w));
  vec2 fade_xy = fade(Pf.xy);
  vec2 n_x = mix(vec2(n00, n01), vec2(n10, n11), fade_xy.x);
  return 2.3 * mix(n_x.x, n_x.y, fade_xy.y);
}
const int OCTAVES = 4;
float fbm(vec2 p) {
  float value = 0.0;
  float amp = 1.0;
  float freq = waveFrequency;
  for (int i = 0; i < OCTAVES; i++) {
    value += amp * abs(cnoise(p));
    p *= freq;
    amp *= waveAmplitude;
  }
  return value;
}
float pattern(vec2 p) {
  vec2 p2 = p - time * waveSpeed;
  return fbm(p + fbm(p2));
}
void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  uv -= 0.5;
  uv.x *= resolution.x / resolution.y;
  float f = pattern(uv);
  if (enableMouseInteraction == 1) {
    vec2 mouseNDC = (mousePos / resolution - 0.5) * vec2(1.0, -1.0);
    mouseNDC.x *= resolution.x / resolution.y;
    float dist = length(uv - mouseNDC);
    float effect = 1.0 - smoothstep(0.0, mouseRadius, dist);
    f -= 0.5 * effect;
  }
  vec3 col = mix(baseColor, waveColor, f);
  gl_FragColor = vec4(col, 1.0);
}`;

const ditherFragmentShader = `
precision highp float;
uniform float colorNum;
uniform float pixelSize;
const float bayerMatrix8x8[64] = float[64](
  0.0/64.0, 48.0/64.0, 12.0/64.0, 60.0/64.0, 3.0/64.0, 51.0/64.0, 15.0/64.0, 63.0/64.0,
  32.0/64.0,16.0/64.0,44.0/64.0,28.0/64.0,35.0/64.0,19.0/64.0,47.0/64.0,31.0/64.0,
  8.0/64.0,56.0/64.0,4.0/64.0,52.0/64.0,11.0/64.0,59.0/64.0,7.0/64.0,55.0/64.0,
  40.0/64.0,24.0/64.0,36.0/64.0,20.0/64.0,43.0/64.0,27.0/64.0,39.0/64.0,23.0/64.0,
  2.0/64.0,50.0/64.0,14.0/64.0,62.0/64.0,1.0/64.0,49.0/64.0,13.0/64.0,61.0/64.0,
  34.0/64.0,18.0/64.0,46.0/64.0,30.0/64.0,33.0/64.0,17.0/64.0,45.0/64.0,29.0/64.0,
  10.0/64.0,58.0/64.0,6.0/64.0,54.0/64.0,9.0/64.0,57.0/64.0,5.0/64.0,53.0/64.0,
  42.0/64.0,26.0/64.0,38.0/64.0,22.0/64.0,41.0/64.0,25.0/64.0,37.0/64.0,21.0/64.0
);
vec3 dither(vec2 uv, vec3 color) {
  vec2 scaledCoord = floor(uv * resolution / pixelSize);
  int x = int(mod(scaledCoord.x, 8.0));
  int y = int(mod(scaledCoord.y, 8.0));
  float threshold = bayerMatrix8x8[y * 8 + x] - 0.25;
  float step = 1.0 / (colorNum - 1.0);
  color += threshold * step;
  float bias = 0.2;
  color = clamp(color - bias, 0.0, 1.0);
  return floor(color * (colorNum - 1.0) + 0.5) / (colorNum - 1.0);
}
void mainImage(in vec4 inputColor, in vec2 uv, out vec4 outputColor) {
  vec2 normalizedPixelSize = pixelSize / resolution;
  vec2 uvPixel = normalizedPixelSize * floor(uv / normalizedPixelSize);
  vec4 color = texture2D(inputBuffer, uvPixel);
  color.rgb = dither(uv, color.rgb);
  outputColor = color;
}`;

class RetroEffect extends Effect {
  constructor() {
    super("RetroEffect", ditherFragmentShader, {
      uniforms: new Map([
        ["colorNum", new THREE.Uniform(4)],
        ["pixelSize", new THREE.Uniform(2)],
      ]),
    });
  }
}

export function createDither(context: BackgroundContext): BackgroundInstance {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.domElement.className = "background-canvas";
  context.host.replaceChildren(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
  camera.position.set(0, 0, 6);
  const geometry = new THREE.PlaneGeometry(1, 1);
  const uniforms = {
    resolution: new THREE.Uniform(new THREE.Vector2()),
    time: new THREE.Uniform(0),
    waveSpeed: new THREE.Uniform(0.05),
    waveFrequency: new THREE.Uniform(3),
    waveAmplitude: new THREE.Uniform(0.3),
    waveColor: new THREE.Uniform(
      new THREE.Color().setRGB(...context.palette.accent, THREE.SRGBColorSpace),
    ),
    baseColor: new THREE.Uniform(
      new THREE.Color().setRGB(...context.palette.paper, THREE.SRGBColorSpace),
    ),
    mousePos: new THREE.Uniform(new THREE.Vector2()),
    enableMouseInteraction: new THREE.Uniform(1),
    mouseRadius: new THREE.Uniform(0.3),
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: waveVertexShader,
    fragmentShader: waveFragmentShader,
    uniforms,
  });
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  const effect = new RetroEffect();
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new EffectPass(camera, effect));

  let destroyed = false;
  let failed = false;
  let frame = 0;
  let visible = context.visible;
  let reducedMotion = context.reducedMotion;
  let disableAnimation = false;
  let enableMouseInteraction = true;
  let programsAsserted = false;
  const startTime = performance.now();
  let frozenTime = 0;

  function fail(error?: unknown) {
    if (destroyed || failed) return;
    failed = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    context.reportRuntimeFailure(error);
  }

  function onContextLost(event: Event) {
    event.preventDefault();
    fail(new Error("Dither WebGL context was lost"));
  }

  function resize() {
    if (destroyed || failed) return;
    const width = context.host.clientWidth;
    const height = context.host.clientHeight;
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
    const viewportHeight =
      2 *
      Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) *
      camera.position.z;
    mesh.scale.set(viewportHeight * camera.aspect, viewportHeight, 1);
    uniforms.resolution.value.set(width, height);
    ensureFrame();
  }

  function onPointerMove(event: PointerEvent) {
    if (
      destroyed ||
      failed ||
      !visible ||
      !enableMouseInteraction ||
      reducedMotion
    )
      return;
    const rect = renderer.domElement.getBoundingClientRect();
    uniforms.mousePos.value.set(
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
    ensureFrame();
  }
  window.addEventListener("pointermove", onPointerMove, { passive: true });

  function draw(now: number) {
    frame = 0;
    if (destroyed || failed || !visible) return;
    frozenTime = ditherElapsedTime(
      startTime,
      now,
      !disableAnimation && !reducedMotion,
      frozenTime,
    );
    uniforms.time.value = frozenTime;
    try {
      composer.render();
      if (!programsAsserted) {
        assertThreePrograms(renderer, "Dither");
        programsAsserted = true;
      }
      context.reportPaint?.();
    } catch (error) {
      fail(error);
      return;
    }
    if (!reducedMotion && !disableAnimation)
      frame = requestAnimationFrame(draw);
  }

  function ensureFrame() {
    if (!destroyed && !failed && visible && frame === 0)
      frame = requestAnimationFrame(draw);
  }

  function update(next: Omit<BackgroundContext, "host">) {
    if (destroyed || failed) return;
    visible = next.visible;
    reducedMotion = next.reducedMotion;
    disableAnimation = Boolean(next.config.disableAnimation);
    enableMouseInteraction = Boolean(next.config.enableMouseInteraction);
    uniforms.waveSpeed.value = Number(next.config.waveSpeed);
    uniforms.waveFrequency.value = Number(next.config.waveFrequency);
    uniforms.waveAmplitude.value = Number(next.config.waveAmplitude);
    uniforms.waveColor.value.setRGB(
      ...next.palette.accent,
      THREE.SRGBColorSpace,
    );
    uniforms.baseColor.value.setRGB(
      ...next.palette.paper,
      THREE.SRGBColorSpace,
    );
    uniforms.enableMouseInteraction.value = enableMouseInteraction ? 1 : 0;
    uniforms.mouseRadius.value = Number(next.config.mouseRadius);
    requiredValue(effect.uniforms.get("colorNum")).value = Number(
      next.config.colorNum,
    );
    if (!visible && frame !== 0) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    ensureFrame();
  }

  renderer.domElement.addEventListener("webglcontextlost", onContextLost);
  resize();
  update(context);

  return {
    update,
    resize,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (frame !== 0) cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener(
        "webglcontextlost",
        onContextLost,
      );
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
      effect.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
