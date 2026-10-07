import { requiredValue } from "./runtime/required-value";
// Adapted from React Bits src/content/Backgrounds/Silk/Silk.jsx
// at 4022efa12a8763a2aeb10768ad0b390d30b6d960. See THIRD_PARTY_NOTICES.md.
import * as THREE from "three";
import { assertThreePrograms } from "./three-runtime";
import type {
  BackgroundContext,
  BackgroundInstance,
  BackgroundUpdateContext,
} from "./runtime/contracts";

export const silkVertexShader = `
varying vec2 vUv;
varying vec3 vPosition;

void main() {
  vPosition = position;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const silkFragmentShader = `
varying vec2 vUv;
varying vec3 vPosition;

uniform float uTime;
uniform vec3  uColor;
uniform vec3  uPaperColor;
uniform float uLift;
uniform float uSpeed;
uniform float uScale;
uniform float uRotation;
uniform float uNoiseIntensity;

const float e = 2.71828182845904523536;

float noise(vec2 texCoord) {
  float G = e;
  vec2  r = (G * sin(G * texCoord));
  return fract(r.x * r.y * (1.0 + texCoord.x));
}

vec2 rotateUvs(vec2 uv, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  mat2  rot = mat2(c, -s, s, c);
  return rot * uv;
}

void main() {
  float rnd        = noise(gl_FragCoord.xy);
  vec2  uv         = rotateUvs(vUv * uScale, uRotation);
  vec2  tex        = uv * uScale;
  float tOffset    = uSpeed * uTime;

  tex.y += 0.03 * sin(8.0 * tex.x - tOffset);

  float pattern = 0.6 +
                  0.4 * sin(5.0 * (tex.x + tex.y +
                                   cos(3.0 * tex.x + 5.0 * tex.y) +
                                   0.02 * tOffset) +
                           sin(20.0 * (tex.x + tex.y - 0.1 * tOffset)));

  vec4 col = vec4(uColor, 1.0) * vec4(pattern) - rnd / 15.0 * uNoiseIntensity;
  col.rgb = mix(col.rgb, uPaperColor, uLift);
  col.a = 1.0;
  gl_FragColor = col;
}
`;

export function silkTimeAdvance(current: number, deltaSeconds: number): number {
  return current + 0.1 * deltaSeconds;
}

export function silkViewportSize(
  fovDegrees: number,
  distance: number,
  aspect: number,
): readonly [number, number] {
  const height = 2 * Math.tan((fovDegrees * Math.PI) / 360) * distance;
  return [height * aspect, height];
}

export function silkDependencySnapshot(
  config: Record<string, unknown>,
  accent: readonly number[],
): string {
  return JSON.stringify([
    Number(config.speed),
    Number(config.scale),
    Number(config.noiseIntensity),
    Number(config.rotation),
    accent[0],
    accent[1],
    accent[2],
  ]);
}

export function createSilk(context: BackgroundContext): BackgroundInstance {
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
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
    renderer.domElement.remove();
  });
  cleanupStack.push(() => {
    renderer.forceContextLoss();
  });
  cleanupStack.push(() => {
    renderer.dispose();
  });

  try {
    renderer.domElement.className = "background-canvas";
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    camera.position.set(0, 0, 5);
    const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
    cleanupStack.push(() => {
      geometry.dispose();
    });
    const color = new THREE.Color().setRGB(
      ...context.palette.accent,
      THREE.SRGBColorSpace,
    );
    const paperColor = new THREE.Color().setRGB(
      ...context.palette.paper,
      THREE.SRGBColorSpace,
    );
    const uniforms = {
      uSpeed: new THREE.Uniform(Number(context.config.speed)),
      uScale: new THREE.Uniform(Number(context.config.scale)),
      uNoiseIntensity: new THREE.Uniform(Number(context.config.noiseIntensity)),
      uColor: new THREE.Uniform(color),
      uPaperColor: new THREE.Uniform(paperColor),
      uLift: new THREE.Uniform(context.palette.lightTheme ? 0.85 : 0),
      uRotation: new THREE.Uniform(Number(context.config.rotation)),
      uTime: new THREE.Uniform(0),
    };
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: silkVertexShader,
      fragmentShader: silkFragmentShader,
    });
    cleanupStack.push(() => {
      material.dispose();
    });
    const plane = new THREE.Mesh(geometry, material);
    cleanupStack.push(() => scene.remove(plane));
    scene.add(plane);

    let frame = 0;
    let destroyed = false;
    let failed = false;
    let visible = context.visible;
    let reducedMotion = context.reducedMotion;
    let lastFrameTime: number | null = null;
    let dependencySnapshot = silkDependencySnapshot(
      context.config,
      context.palette.accent,
    );
    let programsAsserted = false;
    let sizedWidth = -1;
    let sizedHeight = -1;
    let sizedDpr = -1;
    cleanupStack.push(() => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      lastFrameTime = null;
    });

    function fail(error?: unknown) {
      if (destroyed || failed) return;
      failed = true;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      context.reportRuntimeFailure(error);
    }

    function resizeUnsafe() {
      const width = context.host.clientWidth;
      const height = context.host.clientHeight;
      const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
      if (width !== sizedWidth || height !== sizedHeight || dpr !== sizedDpr) {
        renderer.setPixelRatio(dpr);
        renderer.setSize(width, height, false);
        camera.aspect = height === 0 ? 1 : width / height;
        camera.updateProjectionMatrix();
        const viewport = silkViewportSize(
          camera.fov,
          camera.position.z,
          camera.aspect,
        );
        plane.scale.set(viewport[0], viewport[1], 1);
        sizedWidth = width;
        sizedHeight = height;
        sizedDpr = dpr;
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

    function onContextLost(event: Event) {
      event.preventDefault();
      fail(new Error("Silk WebGL context was lost"));
    }
    cleanupStack.push(() => {
      renderer.domElement.removeEventListener(
        "webglcontextlost",
        onContextLost,
      );
    });
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);

    function draw(now: number) {
      frame = 0;
      if (destroyed || failed || !visible) return;
      if (!reducedMotion) {
        if (lastFrameTime !== null)
          uniforms.uTime.value = silkTimeAdvance(
            uniforms.uTime.value,
            (now - lastFrameTime) / 1000,
          );
        lastFrameTime = now;
      } else {
        lastFrameTime = null;
      }
      try {
        renderer.render(scene, camera);
        if (!programsAsserted) {
          assertThreePrograms(renderer, "Silk");
          programsAsserted = true;
        }
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
      const paused =
        visible && (!next.visible || (next.reducedMotion && !reducedMotion));
      const nextDependencySnapshot = silkDependencySnapshot(
        next.config,
        next.palette.accent,
      );
      if (nextDependencySnapshot !== dependencySnapshot) {
        dependencySnapshot = nextDependencySnapshot;
        uniforms.uTime.value = 0;
        lastFrameTime = null;
      }
      visible = next.visible;
      reducedMotion = next.reducedMotion;
      uniforms.uSpeed.value = Number(next.config.speed);
      uniforms.uScale.value = Number(next.config.scale);
      uniforms.uNoiseIntensity.value = Number(next.config.noiseIntensity);
      uniforms.uRotation.value = Number(next.config.rotation);
      color.setRGB(...next.palette.accent, THREE.SRGBColorSpace);
      paperColor.setRGB(...next.palette.paper, THREE.SRGBColorSpace);
      uniforms.uLift.value = next.palette.lightTheme ? 0.85 : 0;
      if (paused || !visible) lastFrameTime = null;
      if (!visible && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
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

    context.host.replaceChildren(renderer.domElement);
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
