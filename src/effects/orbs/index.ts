import { applyMeridianCanvasFilter } from "../meridian-color-filter";
import type {
  BackgroundContext,
  BackgroundInstance,
  ThemePalette,
} from "../runtime/contracts";
import {
  MODE_FRAMES,
  STATE_TO_MODE,
  resolvePreset,
  type OrbFrame,
  type OrbMode,
  type OrbOptions,
  type OrbState,
} from "../../vendor/orbs/engine.js";

export type { OrbState } from "../../vendor/orbs/engine.js";

/**
 * Source-equivalent normalized radius: the upstream 1024px canvas occupies
 * 1024 / 1080 of the shorter side at the 1920×1080 reference viewport.
 */
import { ORBS_DEFAULT_SCALE_PCT } from "../../shared/orbs-metadata";
export const SOURCE_VISUAL_REFERENCE_SIZE = 1024;
/** Hard safety cap for generated dots plus lines. */
export const ORBS_COUNT_CAP = 12_000;
export const ORBS_REDUCED_MOTION_TIME = 0.6;

export interface OrbsConfig {
  [key: string]: number;
  opacity: number;
  speed: number;
  scale: number;
  density: number;
  x: number;
  y: number;
}

export interface OrbsViewportProfile {
  logicalSide: number;
  countScale: number;
  presetSpeed: number;
  options: OrbOptions;
}

export interface OrbsRenderFrame extends OrbFrame {
  logicalSide: number;
  countScale: number;
}

const COUNT_PAIRS = [
  ["latRings", "lonDensity"],
  ["rings", "lonDensity"],
  ["lanes", "segs"],
] as const;
const LINEAR_COUNTS = [
  "orbitN",
  "ghostN",
  "nodeN",
  "strandN",
  "signals",
] as const;
const DENSITY_COUNTS = ["iconD"] as const;

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return Math.min(max, Math.max(min, finiteNumber(value, fallback)));
}

export function normalizeOrbsConfig(
  config: Readonly<Record<string, unknown>>,
): OrbsConfig {
  return {
    opacity: clamp(config.opacity, 1, 0, 1),
    speed: clamp(config.speed, 1, 0.25, 3),
    scale: clamp(config.scale, ORBS_DEFAULT_SCALE_PCT, 10, 60),
    density: clamp(config.density, 100, 25, 200),
    x: clamp(config.x, 0, -50, 50),
    y: clamp(config.y, 0, -50, 50),
  };
}

/** Adapter-side clone of the copied engine's count-scaling rules; engine.js stays untouched. */
function scaleCountOptions(
  options: OrbOptions,
  countScale: number,
): OrbOptions {
  const scaled = { ...options };
  const visited = new Set<string>();
  const dimensionScale = Math.sqrt(countScale);
  for (const [first, second] of COUNT_PAIRS) {
    const firstValue = scaled[first];
    const secondValue = scaled[second];
    if (
      firstValue !== undefined &&
      secondValue !== undefined &&
      !visited.has(first) &&
      !visited.has(second)
    ) {
      scaled[first] = Math.max(2, Math.round(firstValue * dimensionScale));
      scaled[second] = Math.max(2, Math.round(secondValue * dimensionScale));
      visited.add(first);
      visited.add(second);
    }
  }
  for (const key of LINEAR_COUNTS) {
    const value = scaled[key];
    if (value !== undefined && value !== 0 && !visited.has(key)) {
      scaled[key] = Math.max(1, Math.round(value * countScale));
    }
  }
  for (const key of DENSITY_COUNTS) {
    const value = scaled[key];
    if (value !== undefined) scaled[key] = Math.max(0.02, value * countScale);
  }
  return scaled;
}

function frameCount(frame: OrbFrame): number {
  return frame.dots.length + frame.lines.length;
}

interface OrbsBaselineProfile {
  mode: OrbMode;
  options: OrbOptions;
  presetSpeed: number;
  capScale: number;
}

const baselineProfiles = new Map<OrbState, OrbsBaselineProfile>();

/** Resolve and sample each state's source-demo baseline only once, not once per RAF. */
function baselineProfile(state: OrbState): OrbsBaselineProfile {
  const cached = baselineProfiles.get(state);
  if (cached) return cached;
  const preset = resolvePreset(state, SOURCE_VISUAL_REFERENCE_SIZE);
  const baseCount = Math.max(
    1,
    frameCount(
      MODE_FRAMES[preset.mode](
        SOURCE_VISUAL_REFERENCE_SIZE,
        ORBS_REDUCED_MOTION_TIME,
        { ...preset.opts },
      ),
    ),
  );
  // Connecting emits O(nodeN²) lines and Working multiplies orbitN × ghostN.
  const nonlinearCounts = preset.mode === "web" || preset.mode === "orbits";
  const profile = {
    mode: preset.mode,
    options: { ...preset.opts },
    presetSpeed: preset.speed,
    capScale: nonlinearCounts
      ? Math.sqrt(ORBS_COUNT_CAP / baseCount)
      : ORBS_COUNT_CAP / baseCount,
  };
  baselineProfiles.set(state, profile);
  return profile;
}

export function createOrbsViewportProfile(
  state: OrbState,
  width: number,
  height: number,
  config: Readonly<Record<string, unknown>>,
): OrbsViewportProfile {
  const normalized = normalizeOrbsConfig(config);
  // Scale is the visible radius as a percentage of the smaller host dimension.
  const logicalSide = Math.max(
    1,
    Math.min(width, height) * normalized.scale * 0.02,
  );
  const baseline = baselineProfile(state);
  const areaScale = (logicalSide / SOURCE_VISUAL_REFERENCE_SIZE) ** 2;
  const desiredCountScale = (areaScale * normalized.density) / 100;
  const countScale = Math.min(desiredCountScale, baseline.capScale);
  return {
    logicalSide,
    countScale,
    presetSpeed: baseline.presetSpeed,
    options: scaleCountOptions(baseline.options, countScale),
  };
}

function minimumCountOptions(options: OrbOptions): OrbOptions {
  const minimum = { ...options };
  for (const [first, second] of COUNT_PAIRS) {
    if (minimum[first] !== undefined && minimum[second] !== undefined) {
      minimum[first] = 2;
      minimum[second] = 2;
    }
  }
  for (const key of LINEAR_COUNTS) {
    if (minimum[key] !== undefined && minimum[key] !== 0) minimum[key] = 1;
  }
  for (const key of DENSITY_COUNTS) {
    if (minimum[key] !== undefined) minimum[key] = 0.02;
  }
  return minimum;
}

function generateCappedFrame(
  mode: OrbMode,
  logicalSide: number,
  sourceTime: number,
  initialOptions: OrbOptions,
  initialCountScale: number,
): { frame: OrbFrame; countScale: number } {
  let options = initialOptions;
  let countScale = initialCountScale;
  const nonlinearCounts = mode === "web" || mode === "orbits";
  for (let attempt = 0; attempt < 8; attempt++) {
    const frame = MODE_FRAMES[mode](logicalSide, sourceTime, options);
    const count = frameCount(frame);
    if (count <= ORBS_COUNT_CAP) return { frame, countScale };
    const reduction = Math.min(
      0.9,
      (ORBS_COUNT_CAP / count) ** (nonlinearCounts ? 0.5 : 1) * 0.98,
    );
    options = scaleCountOptions(options, reduction);
    countScale *= reduction;
  }
  // Keep every procedural layer represented if rounding prevents convergence.
  const frame = MODE_FRAMES[mode](
    logicalSide,
    sourceTime,
    minimumCountOptions(options),
  );
  if (frameCount(frame) > ORBS_COUNT_CAP) {
    throw new Error(
      `Thinking Orbs ${mode} frame cannot satisfy the ${String(ORBS_COUNT_CAP)} item cap`,
    );
  }
  return { frame, countScale };
}

export function createOrbsFrame(
  state: OrbState,
  width: number,
  height: number,
  config: Readonly<Record<string, unknown>>,
  sourceTime: number,
): OrbsRenderFrame {
  const normalized = normalizeOrbsConfig(config);
  const profile = createOrbsViewportProfile(state, width, height, config);
  const mode = STATE_TO_MODE[state];
  const radiusCompensation = SOURCE_VISUAL_REFERENCE_SIZE / profile.logicalSide;
  const frameOptions = { ...profile.options };
  // The engine applies rMin before returning the frame. Compensate that floor
  // before generation so the returned minimum stays equal to the 1024px demo.
  if (frameOptions.rMin !== undefined) frameOptions.rMin /= radiusCompensation;
  // Move line compensation ahead of the engine's 0.6px floor so small orbs do
  // not inflate that floor when adapted back to source-demo CSS pixels.
  if (frameOptions.lineW !== undefined)
    frameOptions.lineW *= radiusCompensation;
  const { frame, countScale } = generateCappedFrame(
    mode,
    profile.logicalSide,
    sourceTime,
    frameOptions,
    profile.countScale,
  );
  const centerX = width * (0.5 + normalized.x / 100);
  const centerY = height * (0.5 - normalized.y / 100);
  const translateX = centerX - profile.logicalSide / 2;
  const translateY = centerY - profile.logicalSide / 2;
  // Engine frames are fresh allocations, so adapt their geometry in place.
  for (const dot of frame.dots) {
    dot.x += translateX;
    dot.y += translateY;
    dot.r *= radiusCompensation;
  }
  for (const line of frame.lines) {
    line.x1 += translateX;
    line.y1 += translateY;
    line.x2 += translateX;
    line.y2 += translateY;
  }
  return { ...frame, logicalSide: profile.logicalSide, countScale };
}

type Rgb = readonly [number, number, number];

function mixRgb(from: Rgb, to: Rgb, amount: number): [number, number, number] {
  return [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount,
  ];
}

/** Map source black → semantic ink and source white → semantic paper. */
export function orbsPaletteColor(
  palette: ThemePalette,
  white: number,
): [number, number, number] {
  const scalar = Math.min(1, Math.max(0, white));
  if (scalar === 0) return [...palette.ink];
  if (scalar === 1) return [...palette.paper];
  const muted = mixRgb(palette.ink, palette.paper, 0.5);
  return scalar <= 0.5
    ? mixRgb(palette.ink, muted, scalar * 2)
    : mixRgb(muted, palette.paper, (scalar - 0.5) * 2);
}

function cssColor(palette: ThemePalette, white: number, alpha: number): string {
  const color = orbsPaletteColor(palette, white);
  return `rgba(${String(Math.round(color[0] * 255))},${String(Math.round(color[1] * 255))},${String(Math.round(color[2] * 255))},${String(alpha)})`;
}

function paintOrbsFrame(
  context: CanvasRenderingContext2D,
  frame: OrbFrame,
  palette: ThemePalette,
  opacity: number,
): void {
  for (const line of frame.lines) {
    context.strokeStyle = cssColor(
      palette,
      line.white,
      (line.a ?? 1) * opacity,
    );
    context.lineWidth = line.w;
    context.beginPath();
    context.moveTo(line.x1, line.y1);
    context.lineTo(line.x2, line.y2);
    context.stroke();
  }
  // The copied engine finalizes dots in ascending z order; retain that order.
  for (const dot of frame.dots) {
    context.fillStyle = cssColor(palette, dot.white, (dot.a ?? 1) * opacity);
    context.beginPath();
    context.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
    context.fill();
  }
}

const STATE_LABELS: Readonly<Record<OrbState, string>> = {
  working: "Working Thinking Orb background",
  searching: "Searching Thinking Orb background",
  solving: "Solving Thinking Orb background",
  listening: "Listening Thinking Orb background",
  connecting: "Connecting Thinking Orb background",
  weaving: "Weaving Thinking Orb background",
  composing: "Composing Thinking Orb background",
  breathing: "Breathing Thinking Orb background",
  shaping: "Shaping Thinking Orb background",
};

export function createOrbsState(state: OrbState) {
  return (initial: BackgroundContext): BackgroundInstance => {
    let canvas: HTMLCanvasElement | null = document.createElement("canvas");
    canvas.className = "background-canvas";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", STATE_LABELS[state]);
    initial.host.replaceChildren(canvas);

    let paintContext: CanvasRenderingContext2D | null = null;
    let config = initial.config;
    let palette = initial.palette;
    let visible = initial.visible;
    let reducedMotion = initial.reducedMotion;
    let width = 1;
    let height = 1;
    let raf = 0;
    let destroyed = false;
    let failed = false;

    function fail(error: unknown): void {
      if (destroyed || failed) return;
      failed = true;
      if (raf !== 0) cancelAnimationFrame(raf);
      raf = 0;
      initial.reportRuntimeFailure(error);
    }

    function sourceTime(timestamp: number): number {
      if (reducedMotion) return ORBS_REDUCED_MOTION_TIME;
      const normalized = normalizeOrbsConfig(config);
      return (
        (timestamp / 1000) *
        baselineProfile(state).presetSpeed *
        normalized.speed
      );
    }

    function paint(timestamp: number): void {
      if (destroyed || failed || !visible || !canvas || !paintContext) return;
      try {
        const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
        paintContext.setTransform(dpr, 0, 0, dpr, 0, 0);
        paintContext.clearRect(0, 0, width, height);
        const normalized = normalizeOrbsConfig(config);
        const frame = createOrbsFrame(
          state,
          width,
          height,
          normalized,
          sourceTime(timestamp),
        );
        paintOrbsFrame(paintContext, frame, palette, normalized.opacity);
        initial.reportPaint?.();
      } catch (error) {
        fail(error);
      }
    }

    function onFrame(timestamp: number): void {
      raf = 0;
      if (destroyed || failed || !visible || reducedMotion) return;
      paint(timestamp);
      schedule();
    }

    function schedule(): void {
      if (!destroyed && !failed && visible && !reducedMotion && raf === 0) {
        raf = requestAnimationFrame(onFrame);
      }
    }

    function repaint(): void {
      if (!visible) return;
      paint(reducedMotion ? 0 : performance.now());
      schedule();
    }

    function resize(): void {
      if (destroyed || failed || !canvas) return;
      width = Math.max(1, initial.host.clientWidth);
      height = Math.max(1, initial.host.clientHeight);
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${String(width)}px`;
      canvas.style.height = `${String(height)}px`;
      repaint();
    }

    try {
      paintContext = canvas.getContext("2d");
      if (!paintContext)
        throw new Error("Thinking Orbs Canvas 2D context is unavailable");
      applyMeridianCanvasFilter(canvas, config);
      resize();
    } catch (error) {
      fail(error);
    }

    return {
      update(next) {
        if (destroyed || failed || !canvas) return;
        config = next.config;
        palette = next.palette;
        visible = next.visible;
        reducedMotion = next.reducedMotion;
        applyMeridianCanvasFilter(canvas, config);
        if ((!visible || reducedMotion) && raf !== 0) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
        repaint();
      },
      resize,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        if (raf !== 0) cancelAnimationFrame(raf);
        raf = 0;
        canvas?.remove();
        paintContext = null;
        canvas = null;
      },
    };
  };
}
