import { requiredValue } from "./runtime/required-value";
// Adapted from React Bits src/content/Backgrounds/LiquidEther/LiquidEther.jsx
// at 4022efa12a8763a2aeb10768ad0b390d30b6d960. See THIRD_PARTY_NOTICES.md.
import * as THREE from "three";
import {
  assertThreePrograms,
  assertThreeWebGL2,
  threeProgramSnapshot,
  threeProgramsSince,
} from "./three-runtime";
import type {
  BackgroundContext,
  BackgroundInstance,
  BackgroundUpdateContext,
  ThemePalette,
} from "./runtime/contracts";

export const LIQUID_ETHER_DT = 0.014;
export const LIQUID_ETHER_BFECC = true;
export const LIQUID_ETHER_TAKEOVER_DURATION = 0.25;
export const LIQUID_ETHER_AUTO_RESUME_DELAY = 500;
export const LIQUID_ETHER_AUTO_RAMP_DURATION = 0.6;

export function liquidEtherTargetSize(
  width: number,
  height: number,
  resolution: number,
): readonly [number, number] {
  return [
    Math.max(1, Math.round(width * resolution)),
    Math.max(1, Math.round(height * resolution)),
  ];
}

export function liquidEtherTargetFits(
  width: number,
  height: number,
  maxTextureSize: number,
): boolean {
  return width <= maxTextureSize && height <= maxTextureSize;
}

const liquidEtherFaceVertexShader = `
  attribute vec3 position;
  uniform vec2 px;
  uniform vec2 boundarySpace;
  varying vec2 uv;
  precision highp float;
  void main(){
  vec3 pos = position;
  vec2 scale = 1.0 - boundarySpace * 2.0;
  pos.xy = pos.xy * scale;
  uv = vec2(0.5)+(pos.xy)*0.5;
  gl_Position = vec4(pos, 1.0);
}
`;

const liquidEtherLineVertexShader = `
  attribute vec3 position;
  uniform vec2 px;
  precision highp float;
  varying vec2 uv;
  void main(){
  vec3 pos = position;
  uv = 0.5 + pos.xy * 0.5;
  vec2 n = sign(pos.xy);
  pos.xy = abs(pos.xy) - px * 1.0;
  pos.xy *= n;
  gl_Position = vec4(pos, 1.0);
}
`;

const liquidEtherMouseVertexShader = `
    precision highp float;
    attribute vec3 position;
    attribute vec2 uv;
    uniform vec2 center;
    uniform vec2 scale;
    uniform vec2 px;
    varying vec2 vUv;
    void main(){
    vec2 pos = position.xy * scale * 2.0 * px + center;
    vUv = uv;
    gl_Position = vec4(pos, 0.0, 1.0);
}
`;

const liquidEtherAdvectionFragmentShader = `
    precision highp float;
    uniform sampler2D velocity;
    uniform float dt;
    uniform bool isBFECC;
    uniform vec2 fboSize;
    uniform vec2 px;
    varying vec2 uv;
    void main(){
    vec2 ratio = max(fboSize.x, fboSize.y) / fboSize;
    if(isBFECC == false){
        vec2 vel = texture2D(velocity, uv).xy;
        vec2 uv2 = uv - vel * dt * ratio;
        vec2 newVel = texture2D(velocity, uv2).xy;
        gl_FragColor = vec4(newVel, 0.0, 0.0);
    } else {
        vec2 spot_new = uv;
        vec2 vel_old = texture2D(velocity, uv).xy;
        vec2 spot_old = spot_new - vel_old * dt * ratio;
        vec2 vel_new1 = texture2D(velocity, spot_old).xy;
        vec2 spot_new2 = spot_old + vel_new1 * dt * ratio;
        vec2 error = spot_new2 - spot_new;
        vec2 spot_new3 = spot_new - error / 2.0;
        vec2 vel_2 = texture2D(velocity, spot_new3).xy;
        vec2 spot_old2 = spot_new3 - vel_2 * dt * ratio;
        vec2 newVel2 = texture2D(velocity, spot_old2).xy;${" "}
        gl_FragColor = vec4(newVel2, 0.0, 0.0);
    }
}
`;

const liquidEtherColorFragmentShader = `
    precision highp float;
    uniform sampler2D velocity;
    uniform sampler2D palette;
    uniform vec4 bgColor;
    varying vec2 uv;
    void main(){
    vec2 vel = texture2D(velocity, uv).xy;
    float lenv = clamp(length(vel), 0.0, 1.0);
    vec3 c = texture2D(palette, vec2(lenv, 0.5)).rgb;
    vec3 outRGB = mix(bgColor.rgb, c, lenv);
    float outA = mix(bgColor.a, 1.0, lenv);
    gl_FragColor = vec4(outRGB, outA);
}
`;

const liquidEtherDivergenceFragmentShader = `
    precision highp float;
    uniform sampler2D velocity;
    uniform float dt;
    uniform vec2 px;
    varying vec2 uv;
    void main(){
    float x0 = texture2D(velocity, uv-vec2(px.x, 0.0)).x;
    float x1 = texture2D(velocity, uv+vec2(px.x, 0.0)).x;
    float y0 = texture2D(velocity, uv-vec2(0.0, px.y)).y;
    float y1 = texture2D(velocity, uv+vec2(0.0, px.y)).y;
    float divergence = (x1 - x0 + y1 - y0) / 2.0;
    gl_FragColor = vec4(divergence / dt);
}
`;

const liquidEtherExternalForceFragmentShader = `
    precision highp float;
    uniform vec2 force;
    uniform vec2 center;
    uniform vec2 scale;
    uniform vec2 px;
    varying vec2 vUv;
    void main(){
    vec2 circle = (vUv - 0.5) * 2.0;
    float d = 1.0 - min(length(circle), 1.0);
    d *= d;
    gl_FragColor = vec4(force * d, 0.0, 1.0);
}
`;

const liquidEtherPoissonFragmentShader = `
    precision highp float;
    uniform sampler2D pressure;
    uniform sampler2D divergence;
    uniform vec2 px;
    varying vec2 uv;
    void main(){
    float p0 = texture2D(pressure, uv + vec2(px.x * 2.0, 0.0)).r;
    float p1 = texture2D(pressure, uv - vec2(px.x * 2.0, 0.0)).r;
    float p2 = texture2D(pressure, uv + vec2(0.0, px.y * 2.0)).r;
    float p3 = texture2D(pressure, uv - vec2(0.0, px.y * 2.0)).r;
    float div = texture2D(divergence, uv).r;
    float newP = (p0 + p1 + p2 + p3) / 4.0 - div;
    gl_FragColor = vec4(newP);
}
`;

const liquidEtherPressureFragmentShader = `
    precision highp float;
    uniform sampler2D pressure;
    uniform sampler2D velocity;
    uniform vec2 px;
    uniform float dt;
    varying vec2 uv;
    void main(){
    float step = 1.0;
    float p0 = texture2D(pressure, uv + vec2(px.x * step, 0.0)).r;
    float p1 = texture2D(pressure, uv - vec2(px.x * step, 0.0)).r;
    float p2 = texture2D(pressure, uv + vec2(0.0, px.y * step)).r;
    float p3 = texture2D(pressure, uv - vec2(0.0, px.y * step)).r;
    vec2 v = texture2D(velocity, uv).xy;
    vec2 gradP = vec2(p0 - p1, p2 - p3) * 0.5;
    v = v - gradP * dt;
    gl_FragColor = vec4(v, 0.0, 1.0);
}
`;

const liquidEtherViscousFragmentShader = `
    precision highp float;
    uniform sampler2D velocity;
    uniform sampler2D velocity_new;
    uniform float v;
    uniform vec2 px;
    uniform float dt;
    varying vec2 uv;
    void main(){
    vec2 old = texture2D(velocity, uv).xy;
    vec2 new0 = texture2D(velocity_new, uv + vec2(px.x * 2.0, 0.0)).xy;
    vec2 new1 = texture2D(velocity_new, uv - vec2(px.x * 2.0, 0.0)).xy;
    vec2 new2 = texture2D(velocity_new, uv + vec2(0.0, px.y * 2.0)).xy;
    vec2 new3 = texture2D(velocity_new, uv - vec2(0.0, px.y * 2.0)).xy;
    vec2 newv = 4.0 * old + v * dt * (new0 + new1 + new2 + new3);
    newv /= 4.0 * (1.0 + v * dt);
    gl_FragColor = vec4(newv, 0.0, 0.0);
}
`;

type LiquidConfig = {
  mouseForce: number;
  cursorSize: number;
  resolution: number;
  autoSpeed: number;
  autoIntensity: number;
  iterationsPoisson: number;
  isBounce: boolean;
  autoDemo: boolean;
  isViscous: boolean;
  viscous: number;
  iterationsViscous: number;
};

function configOf(config: Record<string, unknown>): LiquidConfig {
  return {
    mouseForce: Number(config.mouseForce),
    cursorSize: Number(config.cursorSize),
    resolution: Number(config.resolution),
    autoSpeed: Number(config.autoSpeed),
    autoIntensity: Number(config.autoIntensity),
    iterationsPoisson: Number(config.iterationsPoisson),
    isBounce: Boolean(config.isBounce),
    autoDemo: Boolean(config.autoDemo),
    isViscous: Boolean(config.isViscous),
    viscous: Number(config.viscous),
    iterationsViscous: Number(config.iterationsViscous),
  };
}

export function makeLiquidEtherPaletteTexture(
  palette: Pick<ThemePalette, "accentHex" | "focusHex" | "inkHex">,
): THREE.DataTexture {
  const stops = [palette.accentHex, palette.focusHex, palette.inkHex];
  const data = new Uint8Array(stops.length * 4);
  for (let index = 0; index < stops.length; index++) {
    const color = new THREE.Color(stops[index]);
    data[index * 4] = Math.round(color.r * 255);
    data[index * 4 + 1] = Math.round(color.g * 255);
    data[index * 4 + 2] = Math.round(color.b * 255);
    data[index * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(
    data,
    stops.length,
    1,
    THREE.RGBAFormat,
  );
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export function createLiquidEther(
  context: BackgroundContext,
): BackgroundInstance {
  let renderer: THREE.WebGLRenderer | null = null;
  let paletteTexture: THREE.DataTexture | null = null;
  const renderTargets: THREE.WebGLRenderTarget[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const scenes: THREE.Scene[] = [];
  let canvas: HTMLCanvasElement | null = null;
  let frame = 0;
  let interactionTimer = 0;
  let destroyed = false;
  let failed = false;
  let visible = context.visible;
  let reducedMotion = context.reducedMotion;
  let config = configOf(context.config);
  let paletteSnapshot = "";
  let sizedWidth = -1;
  let sizedHeight = -1;
  let sizedDpr = -1;
  let sizedResolution = -1;
  let outputProgramsAsserted = false;
  let baseProgramsAsserted = false;
  let viscousProgramsAsserted = false;

  const coords = new THREE.Vector2();
  const oldCoords = new THREE.Vector2();
  const diff = new THREE.Vector2();

  let hoverInside = false;
  let hasUserControl = false;
  let isAutoActive = false;
  let takeoverActive = false;
  let takeoverStartTime = 0;
  const takeoverFrom = new THREE.Vector2();
  const takeoverTo = new THREE.Vector2();
  const autoCurrent = new THREE.Vector2();
  const autoTarget = new THREE.Vector2();
  const autoDirection = new THREE.Vector2();
  let autoActive = false;
  let autoLastTime = performance.now();
  let autoActivationTime = 0;
  let lastUserInteraction = performance.now();

  let fboSize!: THREE.Vector2;
  let cellScale!: THREE.Vector2;
  let boundarySpace!: THREE.Vector2;
  let velocity0!: THREE.WebGLRenderTarget;
  let velocity1!: THREE.WebGLRenderTarget;
  let velocityViscous0!: THREE.WebGLRenderTarget;
  let velocityViscous1!: THREE.WebGLRenderTarget;
  let divergenceTarget!: THREE.WebGLRenderTarget;
  let pressure0!: THREE.WebGLRenderTarget;
  let pressure1!: THREE.WebGLRenderTarget;

  type Pass = {
    scene: THREE.Scene;
    camera: THREE.Camera;
    material: THREE.RawShaderMaterial;
    output: THREE.WebGLRenderTarget | null;
  };
  let advection!: Pass;
  let externalForce!: Pass & {
    mouse: THREE.Mesh<THREE.PlaneGeometry, THREE.RawShaderMaterial>;
  };
  let viscousPass!: Pass;
  let divergencePass!: Pass;
  let poissonPass!: Pass;
  let pressurePass!: Pass;
  let outputPass!: Pass;
  let advectionBoundary!: THREE.LineSegments<
    THREE.BufferGeometry,
    THREE.RawShaderMaterial
  >;

  const ownerWindow = context.host.ownerDocument.defaultView ?? window;
  const ownerDocument = context.host.ownerDocument;

  function disposeOwned(): void {
    clearInteractionState();
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    ownerWindow.removeEventListener("mousemove", onMouseMove);
    ownerWindow.removeEventListener("touchstart", onTouchStart);
    ownerWindow.removeEventListener("touchmove", onTouchMove);
    ownerWindow.removeEventListener("touchend", onTouchEnd);
    ownerWindow.removeEventListener("touchcancel", onTouchEnd);
    ownerDocument.removeEventListener("mouseleave", onDocumentLeave);
    canvas?.removeEventListener("webglcontextlost", onContextLost);
    for (const scene of scenes) scene.clear();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const target of renderTargets) target.dispose();
    paletteTexture?.dispose();
    paletteTexture = null;
    renderer?.dispose();
    renderer?.forceContextLoss();
    canvas?.remove();
  }

  function fail(error?: unknown): void {
    if (destroyed || failed) return;
    failed = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    clearInteractionState();
    context.reportRuntimeFailure(error);
  }

  function isPointInside(clientX: number, clientY: number): boolean {
    const rect = context.host.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    );
  }

  function updateHover(clientX: number, clientY: number): boolean {
    hoverInside = isPointInside(clientX, clientY);
    return hoverInside;
  }

  function pointerCoords(
    clientX: number,
    clientY: number,
    target: THREE.Vector2,
  ): boolean {
    const rect = context.host.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    target.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    return true;
  }

  function setCoords(clientX: number, clientY: number): void {
    if (!pointerCoords(clientX, clientY, coords)) return;

    if (interactionTimer) ownerWindow.clearTimeout(interactionTimer);
    interactionTimer = ownerWindow.setTimeout(() => {}, 100);
  }

  function updateTakeoverDestination(
    clientX: number,
    clientY: number,
  ): boolean {
    return pointerCoords(clientX, clientY, takeoverTo);
  }

  function stopAuto(): void {
    autoActive = false;
    isAutoActive = false;
  }

  function interact(): void {
    lastUserInteraction = performance.now();
    stopAuto();
  }

  function onMouseMove(event: MouseEvent): void {
    if (!updateHover(event.clientX, event.clientY)) return;
    const shouldTakeOver = isAutoActive && !hasUserControl && !takeoverActive;
    interact();
    if (takeoverActive) {
      updateTakeoverDestination(event.clientX, event.clientY);
      hasUserControl = true;
      return;
    }
    if (shouldTakeOver) {
      if (!updateTakeoverDestination(event.clientX, event.clientY)) return;
      takeoverFrom.copy(coords);
      takeoverStartTime = performance.now();
      takeoverActive = true;
      hasUserControl = true;
      isAutoActive = false;
      return;
    }
    setCoords(event.clientX, event.clientY);
    hasUserControl = true;
  }

  function onTouchStart(event: TouchEvent): void {
    if (event.touches.length !== 1) return;
    const touch = requiredValue(event.touches[0]);
    if (!updateHover(touch.clientX, touch.clientY)) return;
    interact();
    if (takeoverActive) updateTakeoverDestination(touch.clientX, touch.clientY);
    else setCoords(touch.clientX, touch.clientY);
    hasUserControl = true;
  }

  function onTouchMove(event: TouchEvent): void {
    if (event.touches.length !== 1) return;
    const touch = requiredValue(event.touches[0]);
    if (!updateHover(touch.clientX, touch.clientY)) return;
    interact();
    if (takeoverActive) updateTakeoverDestination(touch.clientX, touch.clientY);
    else setCoords(touch.clientX, touch.clientY);
  }

  function onTouchEnd(): void {
    hoverInside = false;
  }
  function onDocumentLeave(): void {
    hoverInside = false;
  }

  function clearPointerDelta(): void {
    oldCoords.copy(coords);
    diff.set(0, 0);
    autoLastTime = performance.now();
  }

  function clearInteractionState(): void {
    if (interactionTimer) ownerWindow.clearTimeout(interactionTimer);
    interactionTimer = 0;

    hoverInside = false;
    hasUserControl = false;
    takeoverActive = false;
    stopAuto();
    clearPointerDelta();
  }

  function updateMouse(): void {
    if (takeoverActive) {
      const t =
        (performance.now() - takeoverStartTime) /
        (LIQUID_ETHER_TAKEOVER_DURATION * 1000);
      if (t >= 1) {
        takeoverActive = false;
        coords.copy(takeoverTo);
        oldCoords.copy(coords);
        diff.set(0, 0);
      } else {
        const eased = t * t * (3 - 2 * t);
        coords.copy(takeoverFrom).lerp(takeoverTo, eased);
      }
    }
    diff.subVectors(coords, oldCoords);
    oldCoords.copy(coords);
    if (isAutoActive && !takeoverActive)
      diff.multiplyScalar(config.autoIntensity);
  }

  function pickAutoTarget(): void {
    autoTarget.set(
      (Math.random() * 2 - 1) * 0.8,
      (Math.random() * 2 - 1) * 0.8,
    );
  }

  function updateAuto(): void {
    if (!config.autoDemo) return;
    const now = performance.now();
    if (
      now - lastUserInteraction < LIQUID_ETHER_AUTO_RESUME_DELAY ||
      hoverInside
    ) {
      if (autoActive) stopAuto();
      return;
    }
    if (!autoActive) {
      autoActive = true;
      autoCurrent.copy(coords);
      autoLastTime = now;
      autoActivationTime = now;
    }
    isAutoActive = true;
    let elapsed = (now - autoLastTime) / 1000;
    autoLastTime = now;
    if (elapsed > 0.2) elapsed = 0.016;
    autoDirection.subVectors(autoTarget, autoCurrent);
    const distance = autoDirection.length();
    if (distance < 0.01) {
      pickAutoTarget();
      return;
    }
    autoDirection.normalize();
    const t = Math.min(
      1,
      (now - autoActivationTime) / (LIQUID_ETHER_AUTO_RAMP_DURATION * 1000),
    );
    const ramp = t * t * (3 - 2 * t);
    autoCurrent.addScaledVector(
      autoDirection,
      Math.min(config.autoSpeed * elapsed * ramp, distance),
    );
    coords.copy(autoCurrent);
  }

  function ownGeometry<T extends THREE.BufferGeometry>(geometry: T): T {
    geometries.push(geometry);
    return geometry;
  }
  function ownMaterial<T extends THREE.Material>(material: T): T {
    materials.push(material);
    return material;
  }
  function ownScene(): THREE.Scene {
    const scene = new THREE.Scene();
    scenes.push(scene);
    return scene;
  }

  function makePass(
    uniforms: Record<string, THREE.IUniform>,
    fragmentShader: string,
    output: THREE.WebGLRenderTarget | null,
  ): Pass {
    const scene = ownScene();
    const camera = new THREE.Camera();
    const material = ownMaterial(
      new THREE.RawShaderMaterial({
        vertexShader: liquidEtherFaceVertexShader,
        fragmentShader,
        uniforms,
      }),
    );
    scene.add(
      new THREE.Mesh(ownGeometry(new THREE.PlaneGeometry(2, 2)), material),
    );
    return { scene, camera, material, output };
  }

  function renderPass(pass: Pass): void {
    requiredValue(renderer).setRenderTarget(pass.output);
    requiredValue(renderer).render(pass.scene, pass.camera);
  }

  function resizeUnsafe(): void {
    const rect = context.host.getBoundingClientRect();
    const width = Math.max(0, Math.floor(rect.width));
    const height = Math.max(0, Math.floor(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resolutionChanged = config.resolution !== sizedResolution;
    if (
      width === sizedWidth &&
      height === sizedHeight &&
      dpr === sizedDpr &&
      !resolutionChanged
    )
      return;

    let targetSize: readonly [number, number] | null = null;
    if (width > 0 && height > 0) {
      targetSize = liquidEtherTargetSize(width, height, config.resolution);
      const maxTextureSize = requiredValue(renderer)
        .getContext()
        .getParameter(
          requiredValue(renderer).getContext().MAX_TEXTURE_SIZE,
        ) as number;
      if (
        !liquidEtherTargetFits(targetSize[0], targetSize[1], maxTextureSize)
      ) {
        throw new Error(
          `Liquid Ether target ${String(targetSize[0])}x${String(targetSize[1])} exceeds MAX_TEXTURE_SIZE ${String(maxTextureSize)}`,
        );
      }
    }

    requiredValue(renderer).setPixelRatio(dpr);
    requiredValue(renderer).setSize(width, height, false);
    if (targetSize) {
      const [targetWidth, targetHeight] = targetSize;
      fboSize.set(targetWidth, targetHeight);
      cellScale.set(1 / targetWidth, 1 / targetHeight);
      for (const target of renderTargets)
        target.setSize(targetWidth, targetHeight);
      validateFloatingTargets();
    }
    sizedWidth = width;
    sizedHeight = height;
    sizedDpr = dpr;
    sizedResolution = config.resolution;
  }

  function validateFloatingTargets(): void {
    const gl = requiredValue(renderer).getContext();
    try {
      for (const target of renderTargets) {
        requiredValue(renderer).setRenderTarget(target);
        if (
          gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE
        ) {
          throw new Error("Liquid Ether floating render target is incomplete");
        }
      }
    } finally {
      requiredValue(renderer).setRenderTarget(null);
    }
    const glError = gl.getError();
    if (glError !== gl.NO_ERROR)
      throw new Error(
        `Liquid Ether render-target allocation failed (${String(glError)})`,
      );
  }

  function updatePalette(palette: ThemePalette): void {
    const snapshot = `${palette.accentHex}|${palette.focusHex}|${palette.inkHex}`;
    if (snapshot === paletteSnapshot) return;
    const replacement = makeLiquidEtherPaletteTexture(palette);
    const previous = paletteTexture;
    paletteTexture = replacement;
    paletteSnapshot = snapshot;
    requiredValue(outputPass.material.uniforms.palette).value = replacement;
    previous?.dispose();
  }

  function simulationStep(): void {
    const baseSnapshot = baseProgramsAsserted
      ? null
      : threeProgramSnapshot(requiredValue(renderer));
    let viscousPrograms: WebGLProgram[] | null = null;
    if (config.isBounce) boundarySpace.set(0, 0);
    else boundarySpace.copy(cellScale);
    requiredValue(advection.material.uniforms.dt).value = LIQUID_ETHER_DT;
    requiredValue(advection.material.uniforms.isBFECC).value =
      LIQUID_ETHER_BFECC;
    advectionBoundary.visible = config.isBounce;
    renderPass(advection);

    const cursorSizeX = config.cursorSize * cellScale.x;
    const cursorSizeY = config.cursorSize * cellScale.y;
    const forceUniforms = externalForce.material.uniforms;
    (requiredValue(forceUniforms.force).value as THREE.Vector2).set(
      (diff.x / 2) * config.mouseForce,
      (diff.y / 2) * config.mouseForce,
    );
    (requiredValue(forceUniforms.center).value as THREE.Vector2).set(
      Math.min(
        Math.max(coords.x, -1 + cursorSizeX + cellScale.x * 2),
        1 - cursorSizeX - cellScale.x * 2,
      ),
      Math.min(
        Math.max(coords.y, -1 + cursorSizeY + cellScale.y * 2),
        1 - cursorSizeY - cellScale.y * 2,
      ),
    );
    (requiredValue(forceUniforms.scale).value as THREE.Vector2).set(
      config.cursorSize,
      config.cursorSize,
    );
    renderPass(externalForce);

    let velocity = velocity1;
    if (config.isViscous) {
      const viscousSnapshot = viscousProgramsAsserted
        ? null
        : threeProgramSnapshot(requiredValue(renderer));
      requiredValue(viscousPass.material.uniforms.v).value = config.viscous;
      requiredValue(viscousPass.material.uniforms.dt).value = LIQUID_ETHER_DT;
      for (let index = 0; index < config.iterationsViscous; index++) {
        const input = index % 2 === 0 ? velocityViscous0 : velocityViscous1;
        const output = index % 2 === 0 ? velocityViscous1 : velocityViscous0;
        requiredValue(viscousPass.material.uniforms.velocity_new).value =
          input.texture;
        viscousPass.output = output;
        renderPass(viscousPass);
        velocity = output;
      }
      if (viscousSnapshot) {
        viscousPrograms = threeProgramsSince(
          requiredValue(renderer),
          viscousSnapshot,
        );
        if (viscousPrograms.length > 0) {
          assertThreePrograms(
            requiredValue(renderer),
            "Liquid Ether viscous simulation",
            viscousPrograms,
          );
          viscousProgramsAsserted = true;
        }
      }
    }

    requiredValue(divergencePass.material.uniforms.velocity).value =
      velocity.texture;
    renderPass(divergencePass);
    let pressure = pressure0;
    for (let index = 0; index < config.iterationsPoisson; index++) {
      const input = index % 2 === 0 ? pressure0 : pressure1;
      const output = index % 2 === 0 ? pressure1 : pressure0;
      requiredValue(poissonPass.material.uniforms.pressure).value =
        input.texture;
      poissonPass.output = output;
      renderPass(poissonPass);
      pressure = output;
    }
    requiredValue(pressurePass.material.uniforms.velocity).value =
      velocity.texture;
    requiredValue(pressurePass.material.uniforms.pressure).value =
      pressure.texture;
    renderPass(pressurePass);
    if (baseSnapshot) {
      const viscousSet = viscousPrograms ? new Set(viscousPrograms) : null;
      const basePrograms = threeProgramsSince(
        requiredValue(renderer),
        baseSnapshot,
      ).filter((program) => !viscousSet?.has(program));
      if (basePrograms.length > 0) {
        assertThreePrograms(
          requiredValue(renderer),
          "Liquid Ether base simulation",
          basePrograms,
        );
        baseProgramsAsserted = true;
      }
    }
  }

  function draw(): void {
    frame = 0;
    if (destroyed || failed || !visible || sizedWidth <= 0 || sizedHeight <= 0)
      return;
    try {
      if (!reducedMotion) {
        updateAuto();
        updateMouse();
        simulationStep();
      }
      const outputSnapshot = outputProgramsAsserted
        ? null
        : threeProgramSnapshot(requiredValue(renderer));
      renderPass(outputPass);
      if (outputSnapshot) {
        const outputPrograms = threeProgramsSince(
          requiredValue(renderer),
          outputSnapshot,
        );
        if (outputPrograms.length > 0) {
          assertThreePrograms(
            requiredValue(renderer),
            "Liquid Ether output",
            outputPrograms,
          );
          outputProgramsAsserted = true;
        }
      }
      context.reportPaint?.();
    } catch (error) {
      fail(error);
      return;
    }
    if (!reducedMotion) frame = requestAnimationFrame(draw);
  }

  function ensureFrame(): void {
    if (!destroyed && !failed && visible && frame === 0)
      frame = requestAnimationFrame(draw);
  }

  function onContextLost(event: Event): void {
    event.preventDefault();
    fail(new Error("Liquid Ether WebGL context was lost"));
  }

  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    assertThreeWebGL2(renderer, "Liquid Ether");
    const gl = renderer.getContext();
    const isIOS = /(iPad|iPhone|iPod)/i.test(navigator.userAgent);
    if (
      !gl.getExtension("EXT_color_buffer_float") ||
      (!isIOS && !gl.getExtension("OES_texture_float_linear"))
    ) {
      throw new Error("Liquid Ether floating render targets are unsupported");
    }
    canvas = renderer.domElement;
    canvas.className = "background-canvas";
    renderer.autoClear = false;
    renderer.setClearColor(new THREE.Color(0x000000), 0);
    canvas.addEventListener("webglcontextlost", onContextLost);

    fboSize = new THREE.Vector2(1, 1);
    cellScale = new THREE.Vector2(1, 1);
    boundarySpace = new THREE.Vector2();
    const targetOptions: THREE.RenderTargetOptions = {
      type: isIOS ? THREE.HalfFloatType : THREE.FloatType,
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    };
    for (let index = 0; index < 7; index++)
      renderTargets.push(new THREE.WebGLRenderTarget(1, 1, targetOptions));
    [
      velocity0,
      velocity1,
      velocityViscous0,
      velocityViscous1,
      divergenceTarget,
      pressure0,
      pressure1,
    ] = renderTargets as [
      THREE.WebGLRenderTarget,
      THREE.WebGLRenderTarget,
      THREE.WebGLRenderTarget,
      THREE.WebGLRenderTarget,
      THREE.WebGLRenderTarget,
      THREE.WebGLRenderTarget,
      THREE.WebGLRenderTarget,
    ];

    advection = makePass(
      {
        boundarySpace: { value: cellScale },
        px: { value: cellScale },
        fboSize: { value: fboSize },
        velocity: { value: velocity0.texture },
        dt: { value: LIQUID_ETHER_DT },
        isBFECC: { value: true },
      },
      liquidEtherAdvectionFragmentShader,
      velocity1,
    );
    const boundaryGeometry = ownGeometry(new THREE.BufferGeometry());
    boundaryGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(
        new Float32Array([
          -1, -1, 0, -1, 1, 0, -1, 1, 0, 1, 1, 0, 1, 1, 0, 1, -1, 0, 1, -1, 0,
          -1, -1, 0,
        ]),
        3,
      ),
    );
    const boundaryMaterial = ownMaterial(
      new THREE.RawShaderMaterial({
        vertexShader: liquidEtherLineVertexShader,
        fragmentShader: liquidEtherAdvectionFragmentShader,
        uniforms: advection.material.uniforms,
      }),
    );
    advectionBoundary = new THREE.LineSegments(
      boundaryGeometry,
      boundaryMaterial,
    );
    advection.scene.add(advectionBoundary);

    const forceScene = ownScene();
    const forceCamera = new THREE.Camera();
    const forceMaterial = ownMaterial(
      new THREE.RawShaderMaterial({
        vertexShader: liquidEtherMouseVertexShader,
        fragmentShader: liquidEtherExternalForceFragmentShader,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        uniforms: {
          px: { value: cellScale },
          force: { value: new THREE.Vector2() },
          center: { value: new THREE.Vector2() },
          scale: {
            value: new THREE.Vector2(config.cursorSize, config.cursorSize),
          },
        },
      }),
    );
    const forceMouse = new THREE.Mesh(
      ownGeometry(new THREE.PlaneGeometry(1, 1)),
      forceMaterial,
    );
    forceScene.add(forceMouse);
    externalForce = {
      scene: forceScene,
      camera: forceCamera,
      material: forceMaterial,
      output: velocity1,
      mouse: forceMouse,
    };

    viscousPass = makePass(
      {
        boundarySpace: { value: boundarySpace },
        velocity: { value: velocity1.texture },
        velocity_new: { value: velocityViscous0.texture },
        v: { value: config.viscous },
        px: { value: cellScale },
        dt: { value: LIQUID_ETHER_DT },
      },
      liquidEtherViscousFragmentShader,
      velocityViscous1,
    );
    divergencePass = makePass(
      {
        boundarySpace: { value: boundarySpace },
        velocity: { value: velocityViscous0.texture },
        px: { value: cellScale },
        dt: { value: LIQUID_ETHER_DT },
      },
      liquidEtherDivergenceFragmentShader,
      divergenceTarget,
    );
    poissonPass = makePass(
      {
        boundarySpace: { value: boundarySpace },
        pressure: { value: pressure0.texture },
        divergence: { value: divergenceTarget.texture },
        px: { value: cellScale },
      },
      liquidEtherPoissonFragmentShader,
      pressure1,
    );
    pressurePass = makePass(
      {
        boundarySpace: { value: boundarySpace },
        pressure: { value: pressure0.texture },
        velocity: { value: velocityViscous0.texture },
        px: { value: cellScale },
        dt: { value: LIQUID_ETHER_DT },
      },
      liquidEtherPressureFragmentShader,
      velocity0,
    );

    updatePalette(context.palette);
    outputPass = makePass(
      {
        velocity: { value: velocity0.texture },
        boundarySpace: { value: new THREE.Vector2() },
        palette: { value: paletteTexture },
        bgColor: { value: new THREE.Vector4(0, 0, 0, 0) },
      },
      liquidEtherColorFragmentShader,
      null,
    );
    outputPass.material.transparent = true;
    outputPass.material.depthWrite = false;

    pickAutoTarget();
    ownerWindow.addEventListener("mousemove", onMouseMove);
    ownerWindow.addEventListener("touchstart", onTouchStart, { passive: true });
    ownerWindow.addEventListener("touchmove", onTouchMove, { passive: true });
    ownerWindow.addEventListener("touchend", onTouchEnd);
    ownerWindow.addEventListener("touchcancel", onTouchEnd);
    ownerDocument.addEventListener("mouseleave", onDocumentLeave);
    context.host.replaceChildren(canvas);
    resizeUnsafe();
    ensureFrame();
  } catch (error) {
    destroyed = true;
    disposeOwned();
    throw error;
  }

  return {
    resize() {
      if (destroyed || failed) return;
      try {
        resizeUnsafe();
        ensureFrame();
      } catch (error) {
        fail(error);
      }
    },
    update(next: BackgroundUpdateContext) {
      if (destroyed || failed) return;
      const wasPaused = !visible || reducedMotion;
      visible = next.visible;
      reducedMotion = next.reducedMotion;
      config = configOf(next.config);
      if (!config.autoDemo) stopAuto();
      try {
        updatePalette(next.palette);
        resizeUnsafe();
      } catch (error) {
        fail(error);
        return;
      }
      if (!visible || reducedMotion) {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        clearInteractionState();
      } else if (wasPaused) {
        clearPointerDelta();
      }
      ensureFrame();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      disposeOwned();
    },
  };
}
