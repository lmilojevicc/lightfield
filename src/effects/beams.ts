import { requiredValue } from "./runtime/required-value";
// Adapted from React Bits src/content/Backgrounds/Beams/Beams.jsx
// at 4022efa12a8763a2aeb10768ad0b390d30b6d960. See THIRD_PARTY_NOTICES.md.
import * as THREE from "three";
import { assertThreePrograms } from "./three-runtime";
import type {
  BackgroundContext,
  BackgroundInstance,
  BackgroundUpdateContext,
} from "./runtime/contracts";

export const BEAMS_HEIGHT_SEGMENTS = 100;
export const BEAMS_SPACING = 0;

export const beamsNoise = `
float random (in vec2 st) {
    return fract(sin(dot(st.xy,
                         vec2(12.9898,78.233)))*
        43758.5453123);
}
float noise (in vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) +
           (c - a)* u.y * (1.0 - u.x) +
           (d - b) * u.x * u.y;
}
vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
vec3 fade(vec3 t) {return t*t*t*(t*(t*6.0-15.0)+10.0);}
float cnoise(vec3 P){
  vec3 Pi0 = floor(P);
  vec3 Pi1 = Pi0 + vec3(1.0);
  Pi0 = mod(Pi0, 289.0);
  Pi1 = mod(Pi1, 289.0);
  vec3 Pf0 = fract(P);
  vec3 Pf1 = Pf0 - vec3(1.0);
  vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
  vec4 iy = vec4(Pi0.yy, Pi1.yy);
  vec4 iz0 = Pi0.zzzz;
  vec4 iz1 = Pi1.zzzz;
  vec4 ixy = permute(permute(ix) + iy);
  vec4 ixy0 = permute(ixy + iz0);
  vec4 ixy1 = permute(ixy + iz1);
  vec4 gx0 = ixy0 / 7.0;
  vec4 gy0 = fract(floor(gx0) / 7.0) - 0.5;
  gx0 = fract(gx0);
  vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
  vec4 sz0 = step(gz0, vec4(0.0));
  gx0 -= sz0 * (step(0.0, gx0) - 0.5);
  gy0 -= sz0 * (step(0.0, gy0) - 0.5);
  vec4 gx1 = ixy1 / 7.0;
  vec4 gy1 = fract(floor(gx1) / 7.0) - 0.5;
  gx1 = fract(gx1);
  vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
  vec4 sz1 = step(gz1, vec4(0.0));
  gx1 -= sz1 * (step(0.0, gx1) - 0.5);
  gy1 -= sz1 * (step(0.0, gy1) - 0.5);
  vec3 g000 = vec3(gx0.x,gy0.x,gz0.x);
  vec3 g100 = vec3(gx0.y,gy0.y,gz0.y);
  vec3 g010 = vec3(gx0.z,gy0.z,gz0.z);
  vec3 g110 = vec3(gx0.w,gy0.w,gz0.w);
  vec3 g001 = vec3(gx1.x,gy1.x,gz1.x);
  vec3 g101 = vec3(gx1.y,gy1.y,gz1.y);
  vec3 g011 = vec3(gx1.z,gy1.z,gz1.z);
  vec3 g111 = vec3(gx1.w,gy1.w,gz1.w);
  vec4 norm0 = taylorInvSqrt(vec4(dot(g000,g000),dot(g010,g010),dot(g100,g100),dot(g110,g110)));
  g000 *= norm0.x; g010 *= norm0.y; g100 *= norm0.z; g110 *= norm0.w;
  vec4 norm1 = taylorInvSqrt(vec4(dot(g001,g001),dot(g011,g011),dot(g101,g101),dot(g111,g111)));
  g001 *= norm1.x; g011 *= norm1.y; g101 *= norm1.z; g111 *= norm1.w;
  float n000 = dot(g000, Pf0);
  float n100 = dot(g100, vec3(Pf1.x,Pf0.yz));
  float n010 = dot(g010, vec3(Pf0.x,Pf1.y,Pf0.z));
  float n110 = dot(g110, vec3(Pf1.xy,Pf0.z));
  float n001 = dot(g001, vec3(Pf0.xy,Pf1.z));
  float n101 = dot(g101, vec3(Pf1.x,Pf0.y,Pf1.z));
  float n011 = dot(g011, vec3(Pf0.x,Pf1.yz));
  float n111 = dot(g111, Pf1);
  vec3 fade_xyz = fade(Pf0);
  vec4 n_z = mix(vec4(n000,n100,n010,n110),vec4(n001,n101,n011,n111),fade_xyz.z);
  vec2 n_yz = mix(n_z.xy,n_z.zw,fade_xyz.y);
  float n_xyz = mix(n_yz.x,n_yz.y,fade_xyz.x);
  return 2.2 * n_xyz;
}
`;

export const beamsShaderHeader = `
  varying vec3 vEye;
  varying float vNoise;
  varying vec2 vUv;
  varying vec3 vPosition;
  uniform float time;
  uniform float uSpeed;
  uniform float uNoiseIntensity;
  uniform float uScale;
  ${beamsNoise}`;

export const beamsVertexHeader = `
  float getPos(vec3 pos) {
    vec3 noisePos =
      vec3(pos.x * 0., pos.y - uv.y, pos.z + time * uSpeed * 3.) * uScale;
    return cnoise(noisePos);
  }
  vec3 getCurrentPos(vec3 pos) {
    vec3 newpos = pos;
    newpos.z += getPos(pos);
    return newpos;
  }
  vec3 getNormal(vec3 pos) {
    vec3 curpos = getCurrentPos(pos);
    vec3 nextposX = getCurrentPos(pos + vec3(0.01, 0.0, 0.0));
    vec3 nextposZ = getCurrentPos(pos + vec3(0.0, -0.01, 0.0));
    vec3 tangentX = normalize(nextposX - curpos);
    vec3 tangentZ = normalize(nextposZ - curpos);
    return normalize(cross(tangentZ, tangentX));
  }`;

export const beamsBeginVertexInjection = `transformed.z += getPos(transformed.xyz);`;
export const beamsBeginNormalInjection = `objectNormal = getNormal(position.xyz);`;
export const beamsDitheringInjection = `
    float randomNoise = noise(gl_FragCoord.xy);
    gl_FragColor.rgb -= randomNoise / 15. * uNoiseIntensity;`;

export function beamsRotationRadians(degrees: number): number {
  return THREE.MathUtils.degToRad(degrees);
}

export function beamsTimeAdvance(
  current: number,
  deltaSeconds: number,
): number {
  return current + 0.1 * deltaSeconds;
}

export function beamsTopologyCounts(
  count: number,
  heightSegments = BEAMS_HEIGHT_SEGMENTS,
): { vertices: number; faces: number; indices: number } {
  const indices = count * heightSegments * 6;
  return {
    vertices: count * (heightSegments + 1) * 2,
    faces: indices / 3,
    indices,
  };
}

export type BeamsPhaseMode = "independent" | "shared";

export function createStackedPlanesBufferGeometry(
  count: number,
  width: number,
  height: number,
  spacing = BEAMS_SPACING,
  heightSegments = BEAMS_HEIGHT_SEGMENTS,
  phaseMode: BeamsPhaseMode = "independent",
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  try {
    const topology = beamsTopologyCounts(count, heightSegments);
    const positions = new Float32Array(topology.vertices * 3);
    const indices = new Uint32Array(topology.indices);
    const uvs = new Float32Array(topology.vertices * 2);

    let vertexOffset = 0;
    let indexOffset = 0;
    let uvOffset = 0;
    const totalWidth = count * width + (count - 1) * spacing;
    const xOffsetBase = -totalWidth / 2;
    // Seamless Beams shares only the displacement-relevant Y phase. X remains
    // independently randomized per strip exactly as it is for original Beams.
    const sharedUvYOffset = phaseMode === "shared" ? Math.random() * 300 : null;

    for (let i = 0; i < count; i++) {
      const xOffset = xOffsetBase + i * (width + spacing);
      const uvXOffset = Math.random() * 300;
      const uvYOffset = sharedUvYOffset ?? Math.random() * 300;

      for (let j = 0; j <= heightSegments; j++) {
        const y = height * (j / heightSegments - 0.5);
        const v0 = [xOffset, y, 0];
        const v1 = [xOffset + width, y, 0];
        positions.set([...v0, ...v1], vertexOffset * 3);

        const uvY = j / heightSegments;
        uvs.set(
          [uvXOffset, uvY + uvYOffset, uvXOffset + 1, uvY + uvYOffset],
          uvOffset,
        );

        if (j < heightSegments) {
          const a = vertexOffset;
          const b = vertexOffset + 1;
          const c = vertexOffset + 2;
          const d = vertexOffset + 3;
          indices.set([a, b, c, c, b, d], indexOffset);
          indexOffset += 6;
        }
        vertexOffset += 2;
        uvOffset += 4;
      }
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    return geometry;
  } catch (error) {
    geometry.dispose();
    throw error;
  }
}

export function beamsTopologySnapshot(config: Record<string, unknown>): string {
  return JSON.stringify([
    Number(config.beamWidth),
    Number(config.beamHeight),
    Number(config.beamNumber),
  ]);
}

export function beamsMaterialDependencySnapshot(
  config: Record<string, unknown>,
): string {
  return JSON.stringify([
    Number(config.speed),
    Number(config.noiseIntensity),
    Number(config.scale),
  ]);
}

function beamsRenderSnapshot(context: BackgroundUpdateContext): string {
  return JSON.stringify([
    beamsTopologySnapshot(context.config),
    beamsMaterialDependencySnapshot(context.config),
    Number(context.config.rotation),
    context.palette.paperHex,
    context.palette.inkHex,
  ]);
}

export function createBeamsPhysicalShaders(): {
  vertexShader: string;
  fragmentShader: string;
} {
  const physical = THREE.ShaderLib.physical;
  return {
    vertexShader:
      `${beamsShaderHeader}\n${beamsVertexHeader}\n${physical.vertexShader}`
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>\n${beamsBeginVertexInjection}`,
        )
        .replace(
          "#include <beginnormal_vertex>",
          `#include <beginnormal_vertex>\n${beamsBeginNormalInjection}`,
        ),
    fragmentShader:
      `${beamsShaderHeader}\n\n${physical.fragmentShader}`.replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>\n${beamsDitheringInjection}`,
      ),
  };
}

export function createBeamsMaterial(
  context: BackgroundContext,
): THREE.ShaderMaterial {
  const physical = THREE.ShaderLib.physical;
  const uniforms = THREE.UniformsUtils.clone(physical.uniforms);
  uniforms.diffuse = new THREE.Uniform(
    new THREE.Color(context.palette.paperHex),
  );
  uniforms.time = new THREE.Uniform(0);
  uniforms.roughness = new THREE.Uniform(0.3);
  uniforms.metalness = new THREE.Uniform(0.3);
  uniforms.uSpeed = new THREE.Uniform(Number(context.config.speed));
  uniforms.envMapIntensity = new THREE.Uniform(10);
  uniforms.uNoiseIntensity = new THREE.Uniform(
    Number(context.config.noiseIntensity),
  );
  uniforms.uScale = new THREE.Uniform(Number(context.config.scale));

  const shaders = createBeamsPhysicalShaders();
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: shaders.vertexShader,
    fragmentShader: shaders.fragmentShader,
    lights: true,
    fog: true,
  });
}

export function createBeams(
  context: BackgroundContext,
  phaseMode: BeamsPhaseMode = "independent",
): BackgroundInstance {
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
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    const scene = new THREE.Scene();
    const background = new THREE.Color(context.palette.paperHex);
    scene.background = background;
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 2000);
    camera.position.set(0, 0, 20);

    const group = new THREE.Group();
    group.rotation.z = beamsRotationRadians(Number(context.config.rotation));
    let geometry = createStackedPlanesBufferGeometry(
      Number(context.config.beamNumber),
      Number(context.config.beamWidth),
      Number(context.config.beamHeight),
      BEAMS_SPACING,
      BEAMS_HEIGHT_SEGMENTS,
      phaseMode,
    );
    cleanupStack.push(() => {
      geometry.dispose();
    });
    const material = createBeamsMaterial(context);
    cleanupStack.push(() => {
      material.dispose();
    });
    const mesh = new THREE.Mesh(geometry, material);
    group.add(mesh);

    const directional = new THREE.DirectionalLight(context.palette.inkHex, 1);
    directional.position.set(0, 3, 10);
    directional.shadow.camera.top = 24;
    directional.shadow.camera.bottom = -24;
    directional.shadow.camera.left = -24;
    directional.shadow.camera.right = 24;
    directional.shadow.camera.far = 64;
    directional.shadow.bias = -0.004;
    group.add(directional);
    const ambient = new THREE.AmbientLight(context.palette.inkHex, 1);
    scene.add(group, ambient);
    cleanupStack.push(() => {
      scene.remove(group, ambient);
      group.remove(mesh, directional);
    });
    context.host.replaceChildren(renderer.domElement);

    let frame = 0;
    let destroyed = false;
    let failed = false;
    let visible = context.visible;
    let reducedMotion = context.reducedMotion;
    let lastFrameTime: number | null = null;
    let topologySnapshot = beamsTopologySnapshot(context.config);
    let materialDependencySnapshot = beamsMaterialDependencySnapshot(
      context.config,
    );
    let renderSnapshot = beamsRenderSnapshot(context);
    let programsAsserted = false;
    let sizedWidth = -1;
    let sizedHeight = -1;
    let sizedDpr = -1;
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

    function ensureFrame() {
      if (!destroyed && !failed && visible && frame === 0)
        frame = requestAnimationFrame(draw);
    }

    function resizeUnsafe() {
      const width = context.host.clientWidth;
      const height = context.host.clientHeight;
      const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
      if (width === sizedWidth && height === sizedHeight && dpr === sizedDpr)
        return;
      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height, false);
      camera.aspect = height === 0 ? 1 : width / height;
      camera.updateProjectionMatrix();
      ensureFrame();
      sizedWidth = width;
      sizedHeight = height;
      sizedDpr = dpr;
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
      fail(new Error("Beams WebGL context was lost"));
    }
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);
    cleanupStack.push(() => {
      renderer.domElement.removeEventListener(
        "webglcontextlost",
        onContextLost,
      );
    });

    function draw(now: number) {
      frame = 0;
      if (destroyed || failed || !visible) return;
      if (!reducedMotion) {
        if (lastFrameTime !== null)
          requiredValue(material.uniforms.time).value = beamsTimeAdvance(
            Number(requiredValue(material.uniforms.time).value),
            (now - lastFrameTime) / 1000,
          );
        lastFrameTime = now;
      } else {
        lastFrameTime = null;
      }
      try {
        renderer.render(scene, camera);
        if (!programsAsserted) {
          assertThreePrograms(renderer, "Beams");
          programsAsserted = true;
        }
        context.reportPaint?.();
        if (!reducedMotion) frame = requestAnimationFrame(draw);
      } catch (error) {
        fail(error);
      }
    }

    function updateUnsafe(next: BackgroundUpdateContext) {
      const wasVisible = visible;
      const wasReducedMotion = reducedMotion;
      const nextRenderSnapshot = beamsRenderSnapshot(next);
      const nextTopologySnapshot = beamsTopologySnapshot(next.config);
      const nextMaterialDependencySnapshot = beamsMaterialDependencySnapshot(
        next.config,
      );
      const needsRefresh =
        nextRenderSnapshot !== renderSnapshot ||
        wasVisible !== next.visible ||
        wasReducedMotion !== next.reducedMotion;
      let replacementGeometry: THREE.BufferGeometry | null = null;

      if (nextTopologySnapshot !== topologySnapshot) {
        replacementGeometry = createStackedPlanesBufferGeometry(
          Number(next.config.beamNumber),
          Number(next.config.beamWidth),
          Number(next.config.beamHeight),
          BEAMS_SPACING,
          BEAMS_HEIGHT_SEGMENTS,
          phaseMode,
        );
      }

      try {
        if (nextMaterialDependencySnapshot !== materialDependencySnapshot) {
          requiredValue(material.uniforms.time).value = 0;
          lastFrameTime = null;
        }
        requiredValue(material.uniforms.uSpeed).value = Number(
          next.config.speed,
        );
        requiredValue(material.uniforms.uNoiseIntensity).value = Number(
          next.config.noiseIntensity,
        );
        requiredValue(material.uniforms.uScale).value = Number(
          next.config.scale,
        );
        group.rotation.z = beamsRotationRadians(Number(next.config.rotation));
        background.set(next.palette.paperHex);
        (requiredValue(material.uniforms.diffuse).value as THREE.Color).set(
          next.palette.paperHex,
        );
        directional.color.set(next.palette.inkHex);
        ambient.color.set(next.palette.inkHex);

        visible = next.visible;
        reducedMotion = next.reducedMotion;
        if (
          !visible ||
          wasVisible !== visible ||
          wasReducedMotion !== reducedMotion
        )
          lastFrameTime = null;
        if (!visible && frame) {
          cancelAnimationFrame(frame);
          frame = 0;
        }
        if (needsRefresh) ensureFrame();

        if (replacementGeometry) {
          const oldGeometry = geometry;
          const nextGeometry = replacementGeometry;
          mesh.geometry = nextGeometry;
          try {
            oldGeometry.dispose();
          } catch (error) {
            mesh.geometry = oldGeometry;
            replacementGeometry = null;
            try {
              nextGeometry.dispose();
            } catch {
              // Preserve the replacement failure while releasing the temporary geometry.
            }
            throw error;
          }
          geometry = nextGeometry;
          replacementGeometry = null;
        }
        topologySnapshot = nextTopologySnapshot;
        materialDependencySnapshot = nextMaterialDependencySnapshot;
        renderSnapshot = nextRenderSnapshot;
      } catch (error) {
        replacementGeometry?.dispose();
        throw error;
      }
    }

    function update(next: BackgroundUpdateContext) {
      if (destroyed || failed) return;
      try {
        updateUnsafe(next);
      } catch (error) {
        fail(error);
      }
    }

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

export function createSeamlessBeams(
  context: BackgroundContext,
): BackgroundInstance {
  return createBeams(context, "shared");
}
