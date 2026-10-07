import { requiredValue } from "./runtime/required-value";
// Direct Three.js/postprocessing port of React Bits PixelBlast.jsx at
// c7109dccb42e06592d1d9bc50bc87204697240e2.
// Copyright (c) 2026 David Haz. MIT + Commons Clause License Condition v1.0.
import * as THREE from "three";
import { Effect, EffectComposer, EffectPass, RenderPass } from "postprocessing";
import { assertThreePrograms, assertThreeWebGL2 } from "./three-runtime";
import type {
  BackgroundContext,
  BackgroundInstance,
  BackgroundUpdateContext,
} from "./runtime/contracts";

interface TrailPoint {
  x: number;
  y: number;
  age: number;
  force: number;
  vx: number;
  vy: number;
}
export const PIXEL_BLAST_MAX_TRAIL_POINTS = 64;

export function pushBoundedPixelBlastTrail<T>(trail: T[], point: T): void {
  trail.push(point);
  if (trail.length > PIXEL_BLAST_MAX_TRAIL_POINTS) {
    trail.splice(0, trail.length - PIXEL_BLAST_MAX_TRAIL_POINTS);
  }
}

interface TouchTexture {
  texture: THREE.Texture;
  addTouch(point: { x: number; y: number }): void;
  update(): void;
  radiusScale: number;
  readonly active: boolean;
  dispose(): void;
}

function createTouchTexture(): TouchTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context not available");
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.Texture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const trail: TrailPoint[] = [];
  let last: { x: number; y: number } | null = null;
  const maxAge = 64;
  let radius = 0.1 * size;
  const speed = 1 / maxAge;
  const clear = () => {
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };
  const drawPoint = (point: TrailPoint) => {
    const pos = { x: point.x * size, y: (1 - point.y) * size };
    let intensity: number;
    const easeOutSine = (t: number) => Math.sin((t * Math.PI) / 2);
    const easeOutQuad = (t: number) => -t * (t - 2);
    if (point.age < maxAge * 0.3)
      intensity = easeOutSine(point.age / (maxAge * 0.3));
    else
      intensity =
        easeOutQuad(1 - (point.age - maxAge * 0.3) / (maxAge * 0.7)) || 0;
    intensity *= point.force;
    const color = `${String(((point.vx + 1) / 2) * 255)}, ${String(((point.vy + 1) / 2) * 255)}, ${String(intensity * 255)}`;
    const offset = size * 5;
    ctx.shadowOffsetX = offset;
    ctx.shadowOffsetY = offset;
    ctx.shadowBlur = radius;
    ctx.shadowColor = `rgba(${color},${String(0.22 * intensity)})`;
    ctx.beginPath();
    ctx.fillStyle = "rgba(255,0,0,1)";
    ctx.arc(pos.x - offset, pos.y - offset, radius, 0, Math.PI * 2);
    ctx.fill();
  };
  return {
    texture,
    addTouch(norm) {
      let force = 0;
      let vx = 0;
      let vy = 0;
      if (last) {
        const dx = norm.x - last.x;
        const dy = norm.y - last.y;
        if (dx === 0 && dy === 0) return;
        const dd = dx * dx + dy * dy;
        const d = Math.sqrt(dd);
        vx = dx / (d || 1);
        vy = dy / (d || 1);
        force = Math.min(dd * 10000, 1);
      }
      last = { x: norm.x, y: norm.y };
      const point = { x: norm.x, y: norm.y, age: 0, force, vx, vy };
      const previous = trail[trail.length - 1];
      if (
        previous &&
        Math.floor(previous.x * size) === Math.floor(point.x * size) &&
        Math.floor(previous.y * size) === Math.floor(point.y * size)
      ) {
        Object.assign(previous, point);
      } else {
        pushBoundedPixelBlastTrail(trail, point);
      }
    },
    update() {
      clear();
      for (let index = trail.length - 1; index >= 0; index--) {
        const point = requiredValue(trail[index]);
        const force = point.force * speed * (1 - point.age / maxAge);
        point.x += point.vx * force;
        point.y += point.vy * force;
        point.age++;
        if (point.age > maxAge) trail.splice(index, 1);
      }
      for (const point of trail) drawPoint(point);
      texture.needsUpdate = true;
    },
    set radiusScale(value: number) {
      radius = 0.1 * size * value;
    },
    get radiusScale() {
      return radius / (0.1 * size);
    },
    get active() {
      return trail.length > 0;
    },
    dispose() {
      trail.length = 0;
      last = null;
      texture.dispose();
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}

export const pixelBlastLiquidFragmentShader = `
uniform sampler2D uTexture;
uniform float uStrength;
uniform float uTime;
uniform float uFreq;

void mainUv(inout vec2 uv) {
  vec4 tex = texture2D(uTexture, uv);
  float vx = tex.r * 2.0 - 1.0;
  float vy = tex.g * 2.0 - 1.0;
  float intensity = tex.b;

  float wave = 0.5 + 0.5 * sin(uTime * uFreq + intensity * 6.2831853);

  float amt = uStrength * intensity * wave;

  uv += vec2(vx, vy) * amt;
}
`;

function createLiquidEffect(texture: THREE.Texture): Effect {
  return new Effect("LiquidEffect", pixelBlastLiquidFragmentShader, {
    uniforms: new Map<string, THREE.Uniform<unknown>>([
      ["uTexture", new THREE.Uniform(texture)],
      ["uStrength", new THREE.Uniform(0.1)],
      ["uTime", new THREE.Uniform(0)],
      ["uFreq", new THREE.Uniform(4.5)],
    ]),
  });
}

const SHAPE_MAP: Readonly<Record<string, number>> = {
  square: 0,
  circle: 1,
  triangle: 2,
  diamond: 3,
};
const MAX_CLICKS = 10;

export const pixelBlastVertexShader = `
void main() {
  gl_Position = vec4(position, 1.0);
}
`;

export const pixelBlastFragmentShader = `
precision highp float;

uniform vec3  uColor;
uniform vec2  uResolution;
uniform float uTime;
uniform float uPixelSize;
uniform float uScale;
uniform float uDensity;
uniform float uPixelJitter;
uniform int   uEnableRipples;
uniform float uRippleSpeed;
uniform float uRippleThickness;
uniform float uRippleIntensity;
uniform float uEdgeFade;

uniform int   uShapeType;
const int SHAPE_SQUARE   = 0;
const int SHAPE_CIRCLE   = 1;
const int SHAPE_TRIANGLE = 2;
const int SHAPE_DIAMOND  = 3;

const int   MAX_CLICKS = 10;

uniform vec2  uClickPos  [MAX_CLICKS];
uniform float uClickTimes[MAX_CLICKS];

out vec4 fragColor;

float Bayer2(vec2 a) {
  a = floor(a);
  return fract(a.x / 2. + a.y * a.y * .75);
}
#define Bayer4(a) (Bayer2(.5*(a))*0.25 + Bayer2(a))
#define Bayer8(a) (Bayer4(.5*(a))*0.25 + Bayer2(a))

#define FBM_OCTAVES     5
#define FBM_LACUNARITY  1.25
#define FBM_GAIN        1.0

float hash11(float n){ return fract(sin(n)*43758.5453); }

float vnoise(vec3 p){
  vec3 ip = floor(p);
  vec3 fp = fract(p);
  float n000 = hash11(dot(ip + vec3(0.0,0.0,0.0), vec3(1.0,57.0,113.0)));
  float n100 = hash11(dot(ip + vec3(1.0,0.0,0.0), vec3(1.0,57.0,113.0)));
  float n010 = hash11(dot(ip + vec3(0.0,1.0,0.0), vec3(1.0,57.0,113.0)));
  float n110 = hash11(dot(ip + vec3(1.0,1.0,0.0), vec3(1.0,57.0,113.0)));
  float n001 = hash11(dot(ip + vec3(0.0,0.0,1.0), vec3(1.0,57.0,113.0)));
  float n101 = hash11(dot(ip + vec3(1.0,0.0,1.0), vec3(1.0,57.0,113.0)));
  float n011 = hash11(dot(ip + vec3(0.0,1.0,1.0), vec3(1.0,57.0,113.0)));
  float n111 = hash11(dot(ip + vec3(1.0,1.0,1.0), vec3(1.0,57.0,113.0)));
  vec3 w = fp*fp*fp*(fp*(fp*6.0-15.0)+10.0);
  float x00 = mix(n000, n100, w.x);
  float x10 = mix(n010, n110, w.x);
  float x01 = mix(n001, n101, w.x);
  float x11 = mix(n011, n111, w.x);
  float y0  = mix(x00, x10, w.y);
  float y1  = mix(x01, x11, w.y);
  return mix(y0, y1, w.z) * 2.0 - 1.0;
}

float fbm2(vec2 uv, float t){
  vec3 p = vec3(uv * uScale, t);
  float amp = 1.0;
  float freq = 1.0;
  float sum = 1.0;
  for (int i = 0; i < FBM_OCTAVES; ++i){
    sum  += amp * vnoise(p * freq);
    freq *= FBM_LACUNARITY;
    amp  *= FBM_GAIN;
  }
  return sum * 0.5 + 0.5;
}

float maskCircle(vec2 p, float cov){
  float r = sqrt(cov) * .25;
  float d = length(p - 0.5) - r;
  float aa = 0.5 * fwidth(d);
  return cov * (1.0 - smoothstep(-aa, aa, d * 2.0));
}

float maskTriangle(vec2 p, vec2 id, float cov){
  bool flip = mod(id.x + id.y, 2.0) > 0.5;
  if (flip) p.x = 1.0 - p.x;
  float r = sqrt(cov);
  float d  = p.y - r*(1.0 - p.x);
  float aa = fwidth(d);
  return cov * clamp(0.5 - d/aa, 0.0, 1.0);
}

float maskDiamond(vec2 p, float cov){
  float r = sqrt(cov) * 0.564;
  return step(abs(p.x - 0.49) + abs(p.y - 0.49), r);
}

void main(){
  float pixelSize = uPixelSize;
  vec2 fragCoord = gl_FragCoord.xy - uResolution * .5;
  float aspectRatio = uResolution.x / uResolution.y;

  vec2 pixelId = floor(fragCoord / pixelSize);
  vec2 pixelUV = fract(fragCoord / pixelSize);

  float cellPixelSize = 8.0 * pixelSize;
  vec2 cellId = floor(fragCoord / cellPixelSize);
  vec2 cellCoord = cellId * cellPixelSize;
  vec2 uv = cellCoord / uResolution * vec2(aspectRatio, 1.0);

  float base = fbm2(uv, uTime * 0.05);
  base = base * 0.5 - 0.65;

  float feed = base + (uDensity - 0.5) * 0.3;

  float speed     = uRippleSpeed;
  float thickness = uRippleThickness;
  const float dampT     = 1.0;
  const float dampR     = 10.0;

  if (uEnableRipples == 1) {
    for (int i = 0; i < MAX_CLICKS; ++i){
      vec2 pos = uClickPos[i];
      if (pos.x < 0.0) continue;
      float cellPixelSize = 8.0 * pixelSize;
      vec2 cuv = (((pos - uResolution * .5 - cellPixelSize * .5) / (uResolution))) * vec2(aspectRatio, 1.0);
      float t = max(uTime - uClickTimes[i], 0.0);
      float r = distance(uv, cuv);
      float waveR = speed * t;
      float ring  = exp(-pow((r - waveR) / thickness, 2.0));
      float atten = exp(-dampT * t) * exp(-dampR * r);
      feed = max(feed, ring * atten * uRippleIntensity);
    }
  }

  float bayer = Bayer8(fragCoord / uPixelSize) - 0.5;
  float bw = step(0.5, feed + bayer);

  float h = fract(sin(dot(floor(fragCoord / uPixelSize), vec2(127.1, 311.7))) * 43758.5453);
  float jitterScale = 1.0 + (h - 0.5) * uPixelJitter;
  float coverage = bw * jitterScale;
  float M;
  if      (uShapeType == SHAPE_CIRCLE)   M = maskCircle (pixelUV, coverage);
  else if (uShapeType == SHAPE_TRIANGLE) M = maskTriangle(pixelUV, pixelId, coverage);
  else if (uShapeType == SHAPE_DIAMOND)  M = maskDiamond(pixelUV, coverage);
  else                                   M = coverage;

  if (uEdgeFade > 0.0) {
    vec2 norm = gl_FragCoord.xy / uResolution;
    float edge = min(min(norm.x, norm.y), min(1.0 - norm.x, 1.0 - norm.y));
    float fade = smoothstep(0.0, uEdgeFade, edge);
    M *= fade;
  }

  vec3 color = uColor;

  vec3 srgbColor = mix(
    color * 12.92,
    1.055 * pow(color, vec3(1.0 / 2.4)) - 0.055,
    step(0.0031308, color)
  );

  fragColor = vec4(srgbColor, M);
}
`;

export function pixelBlastShapeValue(variant: unknown): number {
  return typeof variant === "string" ? (SHAPE_MAP[variant] ?? 0) : 0;
}

export function nextPixelBlastClickIndex(index: number): number {
  return (index + 1) % MAX_CLICKS;
}

export function shouldAnimatePixelBlast(
  speed: number,
  reducedMotion: boolean,
  touchActive: boolean,
): boolean {
  return !reducedMotion && (speed !== 0 || touchActive);
}

export interface PixelBlastSizeSnapshot {
  cssWidth: number;
  cssHeight: number;
  dpr: number;
}

export function shouldResizePixelBlast(
  previous: PixelBlastSizeSnapshot | null,
  next: PixelBlastSizeSnapshot,
): boolean {
  return (
    previous === null ||
    previous.cssWidth !== next.cssWidth ||
    previous.cssHeight !== next.cssHeight ||
    previous.dpr !== next.dpr
  );
}

export function pixelBlastSizeContract(
  cssWidth: number,
  cssHeight: number,
  backingWidth: number,
  backingHeight: number,
) {
  return {
    composerWidth: cssWidth,
    composerHeight: cssHeight,
    resolutionWidth: backingWidth,
    resolutionHeight: backingHeight,
  } as const;
}

export function pixelBlastMapToPixels(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, "left" | "top" | "width" | "height">,
  backingWidth: number,
  backingHeight: number,
): { fx: number; fy: number; w: number; h: number } | null {
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    clientX < rect.left ||
    clientX > rect.left + rect.width ||
    clientY < rect.top ||
    clientY > rect.top + rect.height
  )
    return null;
  const scaleX = backingWidth / rect.width;
  const scaleY = backingHeight / rect.height;
  return {
    fx: (clientX - rect.left) * scaleX,
    fy: (rect.height - (clientY - rect.top)) * scaleY,
    w: backingWidth,
    h: backingHeight,
  };
}

interface BlastRuntime {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  material: THREE.ShaderMaterial;
  geometry: THREE.PlaneGeometry;
  quad: THREE.Mesh;
  uniforms: {
    uResolution: THREE.Uniform<THREE.Vector2>;
    uTime: THREE.Uniform<number>;
    uColor: THREE.Uniform<THREE.Color>;
    uClickPos: THREE.Uniform<THREE.Vector2[]>;
    uClickTimes: THREE.Uniform<Float32Array>;
    uShapeType: THREE.Uniform<number>;
    uPixelSize: THREE.Uniform<number>;
    uScale: THREE.Uniform<number>;
    uDensity: THREE.Uniform<number>;
    uPixelJitter: THREE.Uniform<number>;
    uEnableRipples: THREE.Uniform<number>;
    uRippleSpeed: THREE.Uniform<number>;
    uRippleThickness: THREE.Uniform<number>;
    uRippleIntensity: THREE.Uniform<number>;
    uEdgeFade: THREE.Uniform<number>;
  };
  composer?: EffectComposer;
  touch?: TouchTexture;
  liquidEffect?: Effect;
  clickIndex: number;
  timeOffset: number;
  startTime: number;
  programsAsserted: boolean;
  sizeSnapshot: PixelBlastSizeSnapshot | null;
}

function randomFloat(): number {
  if (typeof window.crypto.getRandomValues === "function") {
    const values = new Uint32Array(1);
    window.crypto.getRandomValues(values);
    return requiredValue(values[0]) / 0xffffffff;
  }
  return Math.random();
}

export function createPixelBlast(
  context: BackgroundContext,
): BackgroundInstance {
  let runtime: BlastRuntime | null = null;
  let destroyed = false;
  let failed = false;
  let visible = context.visible;
  let reducedMotion = context.reducedMotion;
  let frame = 0;
  let config = context.config;
  let palette = context.palette;
  let currentLiquid = Boolean(config.liquid);

  function fail(error?: unknown) {
    if (destroyed || failed) return;
    failed = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    context.reportRuntimeFailure(error);
  }

  function disposeRuntime(target: BlastRuntime | null) {
    if (!target) return;
    target.scene.remove(target.quad);
    target.geometry.dispose();
    target.material.dispose();
    target.composer?.dispose();
    target.touch?.dispose();
    target.renderer.domElement.removeEventListener(
      "webglcontextlost",
      onContextLost,
    );
    target.renderer.dispose();
    target.renderer.forceContextLoss();
    target.renderer.domElement.remove();
  }

  function setSize(target = runtime) {
    if (!target || destroyed || failed) return;
    const nextSize = {
      cssWidth: context.host.clientWidth || 1,
      cssHeight: context.host.clientHeight || 1,
      dpr: Math.min(window.devicePixelRatio || 1, 2),
    };
    if (!shouldResizePixelBlast(target.sizeSnapshot, nextSize)) return;
    target.sizeSnapshot = nextSize;
    target.renderer.setPixelRatio(nextSize.dpr);
    target.renderer.setSize(nextSize.cssWidth, nextSize.cssHeight, false);
    const size = pixelBlastSizeContract(
      nextSize.cssWidth,
      nextSize.cssHeight,
      target.renderer.domElement.width,
      target.renderer.domElement.height,
    );
    target.uniforms.uResolution.value.set(
      size.resolutionWidth,
      size.resolutionHeight,
    );
    if (target.composer)
      target.composer.setSize(size.composerWidth, size.composerHeight);
    target.uniforms.uPixelSize.value = Number(config.pixelSize) * nextSize.dpr;
    ensureFrame();
  }

  function initialize() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    disposeRuntime(runtime);
    runtime = null;

    const canvas = document.createElement("canvas");
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    assertThreeWebGL2(renderer, "Pixel Blast");
    renderer.domElement.className = "background-canvas";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearAlpha(0);

    const uniforms: BlastRuntime["uniforms"] = {
      uResolution: new THREE.Uniform(new THREE.Vector2()),
      uTime: new THREE.Uniform(0),
      uColor: new THREE.Uniform(new THREE.Color(palette.accentHex)),
      uClickPos: new THREE.Uniform(
        Array.from({ length: MAX_CLICKS }, () => new THREE.Vector2(-1, -1)),
      ),
      uClickTimes: new THREE.Uniform(new Float32Array(MAX_CLICKS)),
      uShapeType: new THREE.Uniform(pixelBlastShapeValue(config.variant)),
      uPixelSize: new THREE.Uniform(
        Number(config.pixelSize) * renderer.getPixelRatio(),
      ),
      uScale: new THREE.Uniform(Number(config.patternScale)),
      uDensity: new THREE.Uniform(Number(config.patternDensity)),
      uPixelJitter: new THREE.Uniform(Number(config.pixelSizeJitter)),
      uEnableRipples: new THREE.Uniform(config.enableRipples ? 1 : 0),
      uRippleSpeed: new THREE.Uniform(0.3),
      uRippleThickness: new THREE.Uniform(0.1),
      uRippleIntensity: new THREE.Uniform(1),
      uEdgeFade: new THREE.Uniform(Number(config.edgeFade)),
    };
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const material = new THREE.ShaderMaterial({
      vertexShader: pixelBlastVertexShader,
      fragmentShader: pixelBlastFragmentShader,
      uniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      glslVersion: THREE.GLSL3,
    });
    const geometry = new THREE.PlaneGeometry(2, 2);
    const quad = new THREE.Mesh(geometry, material);
    scene.add(quad);

    const next: BlastRuntime = {
      renderer,
      scene,
      camera,
      material,
      geometry,
      quad,
      uniforms,
      clickIndex: 0,
      timeOffset: randomFloat() * 1000,
      startTime: performance.now(),
      programsAsserted: false,
      sizeSnapshot: null,
    };
    runtime = next;
    if (currentLiquid) {
      next.touch = createTouchTexture();
      next.touch.radiusScale = 1;
      next.liquidEffect = createLiquidEffect(next.touch.texture);
      next.composer = new EffectComposer(renderer);
      const renderPass = new RenderPass(scene, camera);
      const effectPass = new EffectPass(camera, next.liquidEffect);
      effectPass.renderToScreen = true;
      next.composer.addPass(renderPass);
      next.composer.addPass(effectPass);
    }
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);
    context.host.replaceChildren(renderer.domElement);
    setSize(next);
    ensureFrame();
  }

  function onContextLost(event: Event) {
    event.preventDefault();
    fail(new Error("Pixel Blast WebGL context was lost"));
  }

  function mappedEvent(event: PointerEvent) {
    if (!runtime) return null;
    return pixelBlastMapToPixels(
      event.clientX,
      event.clientY,
      runtime.renderer.domElement.getBoundingClientRect(),
      runtime.renderer.domElement.width,
      runtime.renderer.domElement.height,
    );
  }

  function onPointerDown(event: PointerEvent) {
    if (destroyed || failed || !visible || reducedMotion || !runtime) return;
    const mapped = mappedEvent(event);
    if (!mapped) return;
    const index = runtime.clickIndex;
    requiredValue(runtime.uniforms.uClickPos.value[index]).set(
      mapped.fx,
      mapped.fy,
    );
    runtime.uniforms.uClickTimes.value[index] = runtime.uniforms.uTime.value;
    runtime.clickIndex = nextPixelBlastClickIndex(index);
    ensureFrame();
  }

  function onPointerMove(event: PointerEvent) {
    if (destroyed || failed || !visible || reducedMotion || !runtime?.touch)
      return;
    const mapped = mappedEvent(event);
    if (!mapped) return;
    runtime.touch.addTouch({
      x: mapped.fx / mapped.w,
      y: mapped.fy / mapped.h,
    });
    ensureFrame();
  }

  function draw(now: number) {
    frame = 0;
    const target = runtime;
    if (destroyed || failed || !visible || !target) return;
    // Pinned-source behavior: live speed changes rescale elapsed wall time, and
    // ripple click timestamps share that same rescaled uTime basis.
    if (!reducedMotion)
      target.uniforms.uTime.value =
        target.timeOffset +
        (now - target.startTime) * 0.001 * Number(config.speed);
    if (target.liquidEffect)
      requiredValue(target.liquidEffect.uniforms.get("uTime")).value =
        target.uniforms.uTime.value;
    try {
      if (target.composer) {
        target.touch?.update();
        target.composer.render();
      } else {
        target.renderer.render(target.scene, target.camera);
      }
      if (!target.programsAsserted) {
        assertThreePrograms(target.renderer, "Pixel Blast");
        target.programsAsserted = true;
      }
      context.reportPaint?.();
    } catch (error) {
      fail(error);
      return;
    }
    if (
      shouldAnimatePixelBlast(
        Number(config.speed),
        reducedMotion,
        target.touch?.active ?? false,
      )
    )
      frame = requestAnimationFrame(draw);
  }

  function ensureFrame() {
    if (!destroyed && !failed && visible && frame === 0)
      frame = requestAnimationFrame(draw);
  }

  function update(next: BackgroundUpdateContext) {
    visible = next.visible;
    reducedMotion = next.reducedMotion;
    config = next.config;
    palette = next.palette;
    const liquid = Boolean(config.liquid);
    if (liquid !== currentLiquid) {
      currentLiquid = liquid;
      try {
        initialize();
      } catch (error) {
        disposeRuntime(runtime);
        runtime = null;
        fail(error);
        return;
      }
    }
    const target = runtime;
    if (!target) return;
    target.uniforms.uShapeType.value = pixelBlastShapeValue(config.variant);
    target.uniforms.uPixelSize.value =
      Number(config.pixelSize) * target.renderer.getPixelRatio();
    target.uniforms.uColor.value.set(palette.accentHex);
    target.uniforms.uScale.value = Number(config.patternScale);
    target.uniforms.uDensity.value = Number(config.patternDensity);
    target.uniforms.uPixelJitter.value = Number(config.pixelSizeJitter);
    target.uniforms.uEnableRipples.value = config.enableRipples ? 1 : 0;
    target.uniforms.uRippleIntensity.value = 1;
    target.uniforms.uRippleThickness.value = 0.1;
    target.uniforms.uRippleSpeed.value = 0.3;
    target.uniforms.uEdgeFade.value = Number(config.edgeFade);
    target.renderer.setClearAlpha(0);
    if (target.liquidEffect) {
      requiredValue(target.liquidEffect.uniforms.get("uStrength")).value = 0.1;
      requiredValue(target.liquidEffect.uniforms.get("uFreq")).value = 4.5;
    }
    if (target.touch) target.touch.radiusScale = 1;
    if (
      (!visible ||
        !shouldAnimatePixelBlast(
          Number(config.speed),
          reducedMotion,
          target.touch?.active ?? false,
        )) &&
      frame
    ) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    ensureFrame();
  }

  window.addEventListener("pointerdown", onPointerDown, { passive: true });
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  try {
    initialize();
    update(context);
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    draw(performance.now());
  } catch (error) {
    window.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointermove", onPointerMove);
    disposeRuntime(runtime);
    runtime = null;
    throw error;
  }

  return {
    update,
    resize: setSize,
    destroy() {
      destroyed = true;
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      disposeRuntime(runtime);
      runtime = null;
    },
  };
}
