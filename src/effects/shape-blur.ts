// Direct Three.js port of React Bits ShapeBlur.jsx at
// c7109dccb42e06592d1d9bc50bc87204697240e2 (fixed live variation 0).
// Copyright (c) 2026 David Haz. MIT + Commons Clause License Condition v1.0.
import * as THREE from "three";
import { assertThreePrograms, assertThreeWebGL2 } from "./three-runtime";
import type {
  BackgroundContext,
  BackgroundInstance,
  BackgroundUpdateContext,
} from "./runtime/contracts";

export const shapeBlurVertexShader = `
varying vec2 v_texcoord;
void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    v_texcoord = uv;
}
`;

export const shapeBlurFragmentShader = `
varying vec2 v_texcoord;

uniform vec2 u_mouse;
uniform vec2 u_resolution;
uniform float u_pixelRatio;
uniform vec3 u_color;

uniform float u_shapeSize;
uniform float u_roundness;
uniform float u_borderSize;
uniform float u_circleSize;
uniform float u_circleEdge;

#ifndef PI
#define PI 3.1415926535897932384626433832795
#endif
#ifndef TWO_PI
#define TWO_PI 6.2831853071795864769252867665590
#endif

#ifndef VAR
#define VAR 0
#endif

#ifndef FNC_COORD
#define FNC_COORD
vec2 coord(in vec2 p) {
    p = p / u_resolution.xy;
    if (u_resolution.x > u_resolution.y) {
        p.x *= u_resolution.x / u_resolution.y;
        p.x += (u_resolution.y - u_resolution.x) / u_resolution.y / 2.0;
    } else {
        p.y *= u_resolution.y / u_resolution.x;
        p.y += (u_resolution.x - u_resolution.y) / u_resolution.x / 2.0;
    }
    p -= 0.5;
    p *= vec2(-1.0, 1.0);
    return p;
}
#endif

#define st0 coord(gl_FragCoord.xy)
#define mx coord(u_mouse * u_pixelRatio)

float sdRoundRect(vec2 p, vec2 b, float r) {
    vec2 d = abs(p - 0.5) * 4.2 - b + vec2(r);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - r;
}
float sdCircle(in vec2 st, in vec2 center) {
    return length(st - center) * 2.0;
}
float sdPoly(in vec2 p, in float w, in int sides) {
    float a = atan(p.x, p.y) + PI;
    float r = TWO_PI / float(sides);
    float d = cos(floor(0.5 + a / r) * r - a) * length(max(abs(p) * 1.0, 0.0));
    return d * 2.0 - w;
}

float aastep(float threshold, float value) {
    float afwidth = length(vec2(dFdx(value), dFdy(value))) * 0.70710678118654757;
    return smoothstep(threshold - afwidth, threshold + afwidth, value);
}
float fill(in float x) { return 1.0 - aastep(0.0, x); }
float fill(float x, float size, float edge) {
    return 1.0 - smoothstep(size - edge, size + edge, x);
}
float stroke(in float d, in float t) { return (1.0 - aastep(t, abs(d))); }
float stroke(float x, float size, float w, float edge) {
    float d = smoothstep(size - edge, size + edge, x + w * 0.5) - smoothstep(size - edge, size + edge, x - w * 0.5);
    return clamp(d, 0.0, 1.0);
}

float strokeAA(float x, float size, float w, float edge) {
    float afwidth = length(vec2(dFdx(x), dFdy(x))) * 0.70710678;
    float d = smoothstep(size - edge - afwidth, size + edge + afwidth, x + w * 0.5)
            - smoothstep(size - edge - afwidth, size + edge + afwidth, x - w * 0.5);
    return clamp(d, 0.0, 1.0);
}

void main() {
    vec2 st = st0 + 0.5;
    vec2 posMouse = mx * vec2(1., -1.) + 0.5;

    float size = u_shapeSize;
    float roundness = u_roundness;
    float borderSize = u_borderSize;
    float circleSize = u_circleSize;
    float circleEdge = u_circleEdge;

    float sdfCircle = fill(
        sdCircle(st, posMouse),
        circleSize,
        circleEdge
    );

    float sdf;
    if (VAR == 0) {
        sdf = sdRoundRect(st, vec2(size), roundness);
        sdf = strokeAA(sdf, 0.0, borderSize, sdfCircle) * 4.0;
    } else if (VAR == 1) {
        sdf = sdCircle(st, vec2(0.5));
        sdf = fill(sdf, 0.6, sdfCircle) * 1.2;
    } else if (VAR == 2) {
        sdf = sdCircle(st, vec2(0.5));
        sdf = strokeAA(sdf, 0.58, 0.02, sdfCircle) * 4.0;
    } else if (VAR == 3) {
        sdf = sdPoly(st - vec2(0.5, 0.45), 0.3, 3);
        sdf = fill(sdf, 0.05, sdfCircle) * 1.4;
    }

    vec3 color = u_color;
    float alpha = sdf;
    gl_FragColor = vec4(color.rgb, alpha);
}
`;

const CONTROL_KEYS = [
  "shapeSize",
  "roundness",
  "borderSize",
  "circleSize",
  "circleEdge",
] as const;

export function shapeBlurConfigChanged(
  previous: Record<string, number>,
  next: Record<string, unknown>,
): boolean {
  return CONTROL_KEYS.some((key) => previous[key] !== Number(next[key]));
}

export interface ShapeBlurSizeContract {
  cssWidth: number;
  cssHeight: number;
  effectiveDpr: number;
}

export function shouldResizeShapeBlur(
  previous: ShapeBlurSizeContract | null,
  next: ShapeBlurSizeContract,
): boolean {
  return (
    previous === null ||
    previous.cssWidth !== next.cssWidth ||
    previous.cssHeight !== next.cssHeight ||
    previous.effectiveDpr !== next.effectiveDpr
  );
}

export function createShapeBlur(
  context: BackgroundContext,
): BackgroundInstance {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera();
  camera.position.z = 1;
  const renderer = new THREE.WebGLRenderer({ alpha: true });
  assertThreeWebGL2(renderer, "Shape Blur");
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.className = "background-canvas";

  const vMouse = new THREE.Vector2();
  const vMouseDamp = new THREE.Vector2();
  const vResolution = new THREE.Vector2();
  const geometry = new THREE.PlaneGeometry(1, 1);
  const uniforms = {
    u_mouse: new THREE.Uniform(vMouseDamp),
    u_resolution: new THREE.Uniform(vResolution),
    u_pixelRatio: new THREE.Uniform(1),
    u_color: new THREE.Uniform(new THREE.Color(context.palette.accentHex)),
    u_shapeSize: new THREE.Uniform(Number(context.config.shapeSize)),
    u_roundness: new THREE.Uniform(Number(context.config.roundness)),
    u_borderSize: new THREE.Uniform(Number(context.config.borderSize)),
    u_circleSize: new THREE.Uniform(Number(context.config.circleSize)),
    u_circleEdge: new THREE.Uniform(Number(context.config.circleEdge)),
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: shapeBlurVertexShader,
    fragmentShader: shapeBlurFragmentShader,
    uniforms,
    defines: { VAR: 0 },
    transparent: true,
  });
  const quad = new THREE.Mesh(geometry, material);
  scene.add(quad);

  let destroyed = false;
  let failed = false;
  let visible = context.visible;
  let reducedMotion = context.reducedMotion;
  let frame = 0;
  let lastTime = 0;
  let pointerSettled = true;
  let sized: ShapeBlurSizeContract | null = null;
  let programsAsserted = false;
  let previousConfig = Object.fromEntries(
    CONTROL_KEYS.map((key) => [key, Number(context.config[key])]),
  ) as Record<string, number>;

  function fail(error?: unknown) {
    if (destroyed || failed) return;
    failed = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    context.reportRuntimeFailure(error);
  }

  function resize() {
    if (destroyed || failed) return;
    const width = context.host.clientWidth;
    const height = context.host.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const nextSize = { cssWidth: width, cssHeight: height, effectiveDpr: dpr };
    if (!shouldResizeShapeBlur(sized, nextSize)) return;
    sized = nextSize;
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.left = -width / 2;
    camera.right = width / 2;
    camera.top = height / 2;
    camera.bottom = -height / 2;
    camera.updateProjectionMatrix();
    quad.scale.set(width, height, 1);
    vResolution.set(width, height).multiplyScalar(dpr);
    uniforms.u_pixelRatio.value = dpr;
    ensureFrame();
  }

  function onPointerMove(event: MouseEvent | PointerEvent) {
    if (reducedMotion || destroyed || failed) return;
    const rect = context.host.getBoundingClientRect();
    vMouse.set(event.clientX - rect.left, event.clientY - rect.top);
    pointerSettled = false;
    ensureFrame();
  }

  function onContextLost(event: Event) {
    event.preventDefault();
    fail(new Error("Shape Blur WebGL context was lost"));
  }

  function draw(now: number) {
    frame = 0;
    if (destroyed || failed || !visible) return;
    const time = now * 0.001;
    const dt = time - lastTime;
    lastTime = time;
    if (!reducedMotion && !pointerSettled) {
      vMouseDamp.x = THREE.MathUtils.damp(vMouseDamp.x, vMouse.x, 8, dt);
      vMouseDamp.y = THREE.MathUtils.damp(vMouseDamp.y, vMouse.y, 8, dt);
      pointerSettled = vMouseDamp.distanceToSquared(vMouse) < 1e-6;
      if (pointerSettled) vMouseDamp.copy(vMouse);
    }
    try {
      renderer.render(scene, camera);
      if (!programsAsserted) {
        assertThreePrograms(renderer, "Shape Blur");
        programsAsserted = true;
      }
      context.reportPaint?.();
    } catch (error) {
      fail(error);
      return;
    }
    if (!reducedMotion && !pointerSettled) frame = requestAnimationFrame(draw);
  }

  function ensureFrame() {
    if (!destroyed && !failed && visible && frame === 0)
      frame = requestAnimationFrame(draw);
  }

  function update(next: BackgroundUpdateContext) {
    visible = next.visible;
    reducedMotion = next.reducedMotion;
    if (shapeBlurConfigChanged(previousConfig, next.config)) {
      vMouse.set(0, 0);
      vMouseDamp.set(0, 0);
      pointerSettled = true;
      lastTime = 0;
    }
    previousConfig = Object.fromEntries(
      CONTROL_KEYS.map((key) => [key, Number(next.config[key])]),
    );
    uniforms.u_shapeSize.value = Number(next.config.shapeSize);
    uniforms.u_roundness.value = Number(next.config.roundness);
    uniforms.u_borderSize.value = Number(next.config.borderSize);
    uniforms.u_circleSize.value = Number(next.config.circleSize);
    uniforms.u_circleEdge.value = Number(next.config.circleEdge);
    uniforms.u_color.value.set(next.palette.accentHex);
    if (!visible && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    ensureFrame();
  }

  renderer.domElement.addEventListener("webglcontextlost", onContextLost);
  document.addEventListener("mousemove", onPointerMove, { passive: true });
  document.addEventListener("pointermove", onPointerMove, { passive: true });
  context.host.replaceChildren(renderer.domElement);
  resize();
  update(context);
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  draw(performance.now());

  return {
    update,
    resize,
    destroy() {
      destroyed = true;
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener("mousemove", onPointerMove);
      document.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener(
        "webglcontextlost",
        onContextLost,
      );
      scene.remove(quad);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
