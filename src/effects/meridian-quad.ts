import { requiredValue } from "./runtime/required-value";
// Shared Three.js fullscreen-quad runtime for Meridian collection shader effects.
// Each quad effect supplies a fragment shader + base opacity; this module
// owns the WebGLRenderer, scene, camera, uniforms, RAF loop, and cleanup.
import {
  Color,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
} from "three";
import { assertThreePrograms, assertThreeWebGL2 } from "./three-runtime";
import type {
  BackgroundContext,
  BackgroundInstance,
} from "./runtime/contracts";
import { applyMeridianCanvasFilter } from "./meridian-color-filter";
import { QUAD_VERT } from "./meridian-glsl";
import { resolveShaderPalette, type PaletteStops } from "../shared/theme";

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

interface QuadOptions {
  fragment: string;
  baseOpacity: number;
  /** Uniforms declared as vec3 paper/ink/accent/muted (true) or paper/paper2/ink/accent/muted (false). */
  usePaper2?: boolean;
  /** Optional 4-stop night/day palettes from shader definition. */
  palettes?: { night?: readonly string[]; day?: readonly string[] };
  /** Force pixelated CSS rendering for dithered outputs. */
  pixelated?: boolean;
  /** Opt-in runtime tuning; omitted values preserve existing effects. */
  maxDpr?: number;
  targetFps?: number;
  pointerTracking?: boolean;
  pointerLerp?: number;
  staticBelowWidth?: number;
  staticOnCoarsePointer?: boolean;
  staticTime?: number;
}

interface QuadState {
  material: ShaderMaterial;
  pointer: Vector2;
  pointerLerp: Vector2;
}

export function shouldAnimateMeridianQuad(
  reducedMotion: boolean,
  width: number,
  staticBelowWidth?: number,
  coarsePointer = false,
  staticOnCoarsePointer = false,
): boolean {
  return (
    !reducedMotion &&
    !(staticBelowWidth !== undefined && width <= staticBelowWidth) &&
    !(staticOnCoarsePointer && coarsePointer)
  );
}

export function shouldRenderMeridianQuadFrame(
  animated: boolean,
  time: number,
  lastRenderedAt: number,
  targetFps?: number,
): boolean {
  return (
    !animated ||
    targetFps === undefined ||
    time - lastRenderedAt >= 1000 / targetFps
  );
}

export function createMeridianQuad(
  context: BackgroundContext,
  options: QuadOptions,
): BackgroundInstance {
  const renderer = new WebGLRenderer({ alpha: true, antialias: false });
  const maxDpr = options.maxDpr ?? 2;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxDpr));
  const canvas = renderer.domElement;
  canvas.className = "background-canvas";
  if (options.pixelated) {
    canvas.style.imageRendering = "pixelated";
  }
  context.host.replaceChildren(canvas);
  const gl = renderer.getContext();
  const state: QuadState = {
    material: null as unknown as ShaderMaterial,
    pointer: new Vector2(0, 0),
    pointerLerp: new Vector2(0, 0),
  };

  let config = context.config;
  let palette = context.palette;
  applyMeridianCanvasFilter(canvas, config);
  let destroyed = false;
  let failed = false;
  let visible = context.visible;
  let reducedMotion = context.reducedMotion;
  let frame = 0;
  let lastRenderedAt = Number.NEGATIVE_INFINITY;
  let staticViewport = false;
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const pointerTracking = Boolean(
    options.pointerTracking && window.matchMedia("(pointer: fine)").matches,
  );

  const initialStops = resolveShaderPalette(palette, options.palettes);
  const currentPal: PaletteStops = [
    [initialStops[0][0], initialStops[0][1], initialStops[0][2]],
    [initialStops[1][0], initialStops[1][1], initialStops[1][2]],
    [initialStops[2][0], initialStops[2][1], initialStops[2][2]],
    [initialStops[3][0], initialStops[3][1], initialStops[3][2]],
  ];
  const targetPal: PaletteStops = [
    [initialStops[0][0], initialStops[0][1], initialStops[0][2]],
    [initialStops[1][0], initialStops[1][1], initialStops[1][2]],
    [initialStops[2][0], initialStops[2][1], initialStops[2][2]],
    [initialStops[3][0], initialStops[3][1], initialStops[3][2]],
  ];

  function fail(error?: unknown) {
    if (destroyed || failed) return;
    failed = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    context.reportRuntimeFailure(error);
  }

  function onContextLost(event: Event) {
    event.preventDefault();
    fail(new Error("Meridian quad WebGL context was lost"));
  }

  const baseUniforms = {
    uTime: { value: 0 },
    uAspect: { value: 1 },
    uPointer: { value: new Vector2(0, 0) },
    uResolution: { value: new Vector2(1, 1) },
    uPaper: { value: new Color() },
    uPaper2: { value: new Color() },
    uInk: { value: new Color() },
    uAccent: { value: new Color() },
    uMuted: { value: new Color() },
    uLightTheme: { value: context.palette.lightTheme ? 1 : 0 },
    uOpacity: { value: options.baseOpacity },
    u_res: { value: new Vector2(1, 1) },
    u_time: { value: 0 },
    u_mouse: { value: new Vector2(0.5, 0.5) },
    u_pix: { value: 3.0 },
    u_c0: {
      value: new Color(currentPal[0][0], currentPal[0][1], currentPal[0][2]),
    },
    u_c1: {
      value: new Color(currentPal[1][0], currentPal[1][1], currentPal[1][2]),
    },
    u_c2: {
      value: new Color(currentPal[2][0], currentPal[2][1], currentPal[2][2]),
    },
    u_c3: {
      value: new Color(currentPal[3][0], currentPal[3][1], currentPal[3][2]),
    },
  };
  const geometry = new PlaneGeometry(2, 2);
  const material = new ShaderMaterial({
    vertexShader: QUAD_VERT,
    fragmentShader: options.fragment,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    uniforms: baseUniforms,
  });
  state.material = material;

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;

  const scene = new Scene();
  scene.add(mesh);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  function applyColors() {
    baseUniforms.uPaper.value.setRGB(
      palette.paper[0],
      palette.paper[1],
      palette.paper[2],
    );
    baseUniforms.uPaper2.value.setRGB(
      palette.paper[0] * 0.92 + 0.05,
      palette.paper[1] * 0.92 + 0.05,
      palette.paper[2] * 0.92 + 0.05,
    );
    baseUniforms.uInk.value.setRGB(
      palette.ink[0],
      palette.ink[1],
      palette.ink[2],
    );
    baseUniforms.uAccent.value.setRGB(
      palette.accent[0],
      palette.accent[1],
      palette.accent[2],
    );
    baseUniforms.uMuted.value.setRGB(
      (palette.ink[0] + palette.paper[0]) * 0.5,
      (palette.ink[1] + palette.paper[1]) * 0.5,
      (palette.ink[2] + palette.paper[2]) * 0.5,
    );
    baseUniforms.uLightTheme.value = palette.lightTheme ? 1 : 0;
    const nextStops = resolveShaderPalette(palette, options.palettes);
    for (let i = 0; i < 4; i++) {
      requiredValue(targetPal[i])[0] = requiredValue(nextStops[i])[0];
      requiredValue(targetPal[i])[1] = requiredValue(nextStops[i])[1];
      requiredValue(targetPal[i])[2] = requiredValue(nextStops[i])[2];
    }
  }

  function resize() {
    if (destroyed || failed) return;
    const dpr = Math.min(window.devicePixelRatio, maxDpr);
    renderer.setPixelRatio(dpr);
    const width = context.host.clientWidth;
    const height = Math.max(context.host.clientHeight, 1);
    staticViewport = !shouldAnimateMeridianQuad(
      false,
      width,
      options.staticBelowWidth,
      coarsePointer,
      options.staticOnCoarsePointer,
    );
    renderer.setSize(width, height);
    baseUniforms.uAspect.value = width / height;
    baseUniforms.uResolution.value.set(width, height);
    baseUniforms.u_pix.value = dpr * 3.0;
    baseUniforms.u_res.value.set(
      renderer.domElement.width,
      renderer.domElement.height,
    );
    ensureFrame();
  }

  function draw(time: number) {
    frame = 0;
    if (destroyed || failed || !visible) return;
    const animated = !reducedMotion && !staticViewport;
    if (
      !shouldRenderMeridianQuadFrame(
        animated,
        time,
        lastRenderedAt,
        options.targetFps,
      )
    ) {
      frame = requestAnimationFrame(draw);
      return;
    }
    lastRenderedAt = time;
    baseUniforms.uTime.value = animated
      ? time * 0.001
      : (options.staticTime ?? time * 0.001);
    baseUniforms.u_time.value = baseUniforms.uTime.value;
    const opacityValue = Number(config.opacity);
    const fade = Number.isFinite(opacityValue) ? opacityValue / 0.5 : 1;
    baseUniforms.uOpacity.value = options.baseOpacity * fade;
    if (pointerTracking && animated) {
      state.pointerLerp.lerp(state.pointer, options.pointerLerp ?? 0.08);
    } else {
      state.pointerLerp.set(0, 0);
    }
    baseUniforms.uPointer.value.copy(state.pointerLerp);
    baseUniforms.u_mouse.value.set(
      state.pointerLerp.x * 0.5 + 0.5,
      state.pointerLerp.y * 0.5 + 0.5,
    );

    // Palette smoothing: 4-stop asymptotic exponential lerp (0.05 per frame in requestAnimationFrame)
    let palDiff = 0;
    for (let i = 0; i < 4; i++) {
      const cur = requiredValue(currentPal[i]);
      const tgt = requiredValue(targetPal[i]);
      cur[0] = lerp(cur[0], tgt[0], 0.05);
      cur[1] = lerp(cur[1], tgt[1], 0.05);
      cur[2] = lerp(cur[2], tgt[2], 0.05);
      palDiff = Math.max(
        palDiff,
        Math.abs(cur[0] - tgt[0]),
        Math.abs(cur[1] - tgt[1]),
        Math.abs(cur[2] - tgt[2]),
      );
    }
    baseUniforms.u_c0.value.setRGB(
      currentPal[0][0],
      currentPal[0][1],
      currentPal[0][2],
    );
    baseUniforms.u_c1.value.setRGB(
      currentPal[1][0],
      currentPal[1][1],
      currentPal[1][2],
    );
    baseUniforms.u_c2.value.setRGB(
      currentPal[2][0],
      currentPal[2][1],
      currentPal[2][2],
    );
    baseUniforms.u_c3.value.setRGB(
      currentPal[3][0],
      currentPal[3][1],
      currentPal[3][2],
    );

    try {
      renderer.render(scene, camera);
      context.reportPaint?.();
    } catch (error) {
      fail(error);
      return;
    }
    if (animated || palDiff > 0.0005) frame = requestAnimationFrame(draw);
  }

  function ensureFrame() {
    if (!destroyed && !failed && visible && frame === 0)
      frame = requestAnimationFrame(draw);
  }

  function onPointerMove(event: PointerEvent) {
    if (reducedMotion || staticViewport) return;
    const rect = canvas.getBoundingClientRect();
    if (
      rect.width === 0 ||
      rect.height === 0 ||
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    ) {
      state.pointer.set(0, 0);
    } else {
      state.pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((event.clientY - rect.top) / rect.height) * 2,
      );
    }
    ensureFrame();
  }

  function resetPointer() {
    state.pointer.set(0, 0);
    ensureFrame();
  }

  applyColors();
  try {
    assertThreeWebGL2(renderer, "Meridian quad");
    renderer.compile(scene, camera);
    assertThreePrograms(renderer, "Meridian quad");
  } catch (error) {
    geometry.dispose();
    material.dispose();
    renderer.dispose();
    canvas.remove();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    throw error;
  }

  canvas.addEventListener("webglcontextlost", onContextLost);
  if (pointerTracking) {
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerleave", resetPointer);
  }

  function update(next: {
    config: typeof config;
    palette: typeof palette;
    visible: boolean;
    reducedMotion: boolean;
  }) {
    if (destroyed || failed) return;
    config = next.config;
    palette = next.palette;
    applyMeridianCanvasFilter(canvas, config);
    visible = next.visible;
    reducedMotion = next.reducedMotion;
    if (reducedMotion) state.pointer.set(0, 0);
    applyColors();
    if (!visible && frame !== 0) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    ensureFrame();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    canvas.removeEventListener("webglcontextlost", onContextLost);
    if (pointerTracking) {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", resetPointer);
    }
    geometry.dispose();
    material.dispose();
    renderer.dispose();
    canvas.remove();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  resize();

  return {
    update,
    resize,
    destroy,
  };
}
