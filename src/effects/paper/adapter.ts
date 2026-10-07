import { requiredValue } from "../runtime/required-value";
// Native Paper Shaders integration; upstream GLSL and noise remain unchanged.
// See THIRD_PARTY_NOTICES.md for Apache-2.0 provenance and mount changes.
import {
  getShaderColorFromString,
  getShaderNoiseTexture,
} from "@paper-design/shaders";
import type { BackgroundControlValue } from "../../shared/background-metadata";
import type {
  BackgroundContext,
  BackgroundInstance,
  ThemePalette,
} from "../runtime/contracts";
import {
  PAPER_DEFINITIONS,
  type PaperBackgroundId,
} from "../../shared/paper-metadata";
import {
  ShaderMount,
  type ShaderMountUniforms,
  type ShaderSizingAnimation,
} from "./shader-mount";

const PAPER_MAX_PIXEL_COUNT = 1920 * 1080;
const PAPER_MAX_DPR = 1.5;
const PAPER_MIN_DPR = 1;

/** Same bounds as persisted settings, also applied at the native factory seam. */
export function normalizePaperConfig(
  id: PaperBackgroundId,
  input: Record<string, BackgroundControlValue>,
) {
  const definition = PAPER_DEFINITIONS[id];
  const config = { ...definition.defaults };
  for (const control of definition.controls) {
    const value = input[control.key];
    if (
      control.type === "number" &&
      typeof value === "number" &&
      Number.isFinite(value)
    ) {
      config[control.key] = Math.max(control.min, Math.min(control.max, value));
    } else if (control.type === "boolean" && typeof value === "boolean") {
      config[control.key] = value;
    } else if (
      control.type === "select" &&
      typeof value === "string" &&
      control.options.some((o) => o.value === value)
    ) {
      config[control.key] = value;
    }
  }
  return config;
}

/** Preserve source palette order/cardinality/duplicates/alpha. Luminance ranks map
 * along paper → accent → focus → ink, keeping semantic roles on light/dark themes. */
function paperPaletteColors(
  source: readonly string[],
  palette: ThemePalette,
): [number, number, number, number][] {
  const colors = source.map(getShaderColorFromString);
  const luminance = (c: number[]) =>
    0.2126 * requiredValue(c[0]) +
    0.7152 * requiredValue(c[1]) +
    0.0722 * requiredValue(c[2]);
  const ranks = [...new Set(colors.map((c) => c.slice(0, 3).join(",")))].sort(
    (a, b) =>
      luminance(a.split(",").map(Number)) - luminance(b.split(",").map(Number)),
  );
  const ramp = [palette.paper, palette.accent, palette.focus, palette.ink];
  return colors.map((color) => {
    const t =
      ranks.length === 1
        ? 1.5
        : (3 * ranks.indexOf(color.slice(0, 3).join(","))) / (ranks.length - 1);
    const index = Math.min(2, Math.floor(t));
    return [
      ...requiredValue(ramp[index]).map(
        (v, channel) =>
          v +
          (requiredValue(requiredValue(ramp[index + 1])[channel]) - v) *
            (t - index),
      ),
      color[3],
    ] as [number, number, number, number];
  });
}

let noisePromise: Promise<HTMLImageElement> | undefined;
function decodedPaperNoise(): Promise<HTMLImageElement> {
  return (noisePromise ??= (async () => {
    const image = getShaderNoiseTexture();
    if (!image) throw new Error("Paper Shaders: noise image unavailable");
    await image.decode();
    return image;
  })().catch((error: unknown) => {
    noisePromise = undefined;
    throw error;
  }));
}

type UniformMapper = (
  config: Record<string, BackgroundControlValue>,
  palette: ThemePalette,
  colors: [number, number, number, number][],
  noise?: HTMLImageElement,
) => ShaderMountUniforms;

export async function createPaperBackground(
  context: BackgroundContext,
  id: PaperBackgroundId,
  fragment: string,
  uniforms: UniformMapper,
  sizingAnimation?: ShaderSizingAnimation,
): Promise<BackgroundInstance> {
  const definition = PAPER_DEFINITIONS[id];
  const noise = definition.noise ? await decodedPaperNoise() : undefined;
  // Controller may have switched while the bundled PNG decoded. Never allocate an orphan context.
  if (!context.host.isConnected)
    return { update() {}, resize() {}, destroy() {} };
  let config = normalizePaperConfig(id, context.config);
  let palette = context.palette;
  let appliedSignature = JSON.stringify([config, palette]);
  let appliedFrame = config.frame;
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;inset:0;pointer-events:none";
  host.setAttribute("aria-hidden", "true");
  context.host.appendChild(host);
  let mount: ShaderMount | undefined;
  const effectiveSpeed = (reduced: boolean, visible: boolean) =>
    definition.animated && !reduced && visible ? Number(config.speed) : 0;
  const style = () => {
    host.style.opacity = String(config.opacity);
    host.style.filter = `brightness(${String(config.brightness)}) saturate(${String(config.saturation)}) contrast(${String(config.contrast)})`;
  };
  const destroy = () => {
    mount?.dispose();
    mount = undefined;
    host.remove();
  };
  try {
    style();
    mount = new ShaderMount(
      host,
      fragment,
      uniforms(
        config,
        palette,
        paperPaletteColors(definition.sourceColors, palette),
        noise,
      ),
      { alpha: true, antialias: false, powerPreference: "low-power" },
      0,
      Number(config.frame ?? 0),
      PAPER_MIN_DPR,
      PAPER_MAX_PIXEL_COUNT,
      [],
      (error) => {
        destroy();
        context.reportRuntimeFailure(error);
      },
      PAPER_MAX_DPR,
      sizingAnimation,
      () => context.reportPaint?.(),
    );
    host.dataset.paperReady = "true";
    mount.setSpeed(effectiveSpeed(context.reducedMotion, context.visible));
  } catch (error) {
    destroy();
    throw error;
  }
  return {
    update(next) {
      if (!mount) return;
      const nextConfig = normalizePaperConfig(id, next.config);
      const signature = JSON.stringify([nextConfig, next.palette]);
      const changed = signature !== appliedSignature;
      config = nextConfig;
      palette = next.palette;
      mount.setSpeed(effectiveSpeed(next.reducedMotion, next.visible));
      if (!next.visible) {
        mount.setPaintEnabled(false);
        return;
      }
      style();
      if (changed) {
        mount.setUniforms(
          uniforms(
            config,
            palette,
            paperPaletteColors(definition.sourceColors, palette),
            noise,
          ),
        );
        appliedSignature = signature;
      }
      if (definition.animated && config.frame !== appliedFrame)
        mount.setFrame(Number(config.frame));
      appliedFrame = config.frame;
      mount.setPaintEnabled(true);
    },
    // CSS host + mount ResizeObserver/visualViewport handle sizing and DPR changes.
    resize() {},
    destroy,
  };
}
