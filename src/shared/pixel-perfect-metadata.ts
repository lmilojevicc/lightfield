// Source metadata: Pixel Perfect by Vansh Nagar. Reuse permission remains a release blocker.
// See THIRD_PARTY_NOTICES.md; inclusion here does not grant redistribution rights.
import type {
  BackgroundControl,
  BackgroundControlValue,
} from "./control-types";

export const PIXEL_PERFECT_IDS = [
  "pixel-perfect-dither-wave",
  "pixel-perfect-currency-sky",
  "pixel-perfect-braille-terrain",
  "pixel-perfect-contour-map",
  "pixel-perfect-halftone-blobs",
  "pixel-perfect-dither-field",
] as const;
export type PixelPerfectId = (typeof PIXEL_PERFECT_IDS)[number];
export type PixelPerfectConfig = Record<string, BackgroundControlValue>;
const number = (
  key: string,
  label: string,
  min: number,
  max: number,
  step: number,
): BackgroundControl => ({ key, label, type: "number", min, max, step });
const speed = number("speed", "Speed", 0, 3, 0.1);
const paused: BackgroundControl = {
  key: "paused",
  label: "Pause",
  type: "boolean",
};

/** Source geometry/tuning defaults; colors follow the resolved app palette. */
export const PIXEL_PERFECT_DEFINITIONS: Record<
  PixelPerfectId,
  {
    name: string;
    defaults: PixelPerfectConfig;
    controls: readonly BackgroundControl[];
  }
> = {
  "pixel-perfect-dither-wave": {
    name: "Dither Wave",
    defaults: {
      pixelSize: 2.5,
      density: 0.74,
      speed: 1,
      interactive: true,
      paused: false,
    },
    controls: [
      speed,
      number("pixelSize", "Pixel size", 1, 10, 0.5),
      number("density", "Density", 0, 1, 0.01),
      { key: "interactive", label: "Pointer interaction", type: "boolean" },
      paused,
    ],
  },
  "pixel-perfect-currency-sky": {
    name: "Currency Sky",
    defaults: {
      speed: 0.9,
      opacity: 1,
      cellWidth: 12,
      cellHeight: 14,
      fontSize: 12,
      terrainScale: 0.13,
      contourSpacing: 0.08,
      paused: false,
    },
    controls: [
      speed,
      number("opacity", "Opacity", 0, 1, 0.05),
      number("cellWidth", "Cell width", 8, 32, 1),
      number("cellHeight", "Cell height", 8, 32, 1),
      number("fontSize", "Font size", 6, 24, 1),
      number("terrainScale", "Terrain scale", 0.01, 0.4, 0.01),
      number("contourSpacing", "Contour spacing", 0.02, 0.3, 0.01),
      paused,
    ],
  },
  "pixel-perfect-braille-terrain": {
    name: "Braille Terrain",
    defaults: {
      cellSize: 10,
      scale: 0.06,
      speed: 1,
      opacity: 1,
      paused: false,
    },
    controls: [
      speed,
      number("cellSize", "Cell size", 6, 24, 1),
      number("scale", "Scale", 0.01, 0.2, 0.01),
      number("opacity", "Opacity", 0, 1, 0.05),
      paused,
    ],
  },
  "pixel-perfect-contour-map": {
    name: "Contour Map",
    defaults: { levels: 14, lineWidth: 1, speed: 1, paused: false },
    controls: [
      speed,
      number("levels", "Levels", 2, 40, 1),
      number("lineWidth", "Line width", 0.25, 4, 0.25),
      paused,
    ],
  },
  "pixel-perfect-halftone-blobs": {
    name: "Halftone Blobs",
    defaults: { spacing: 11, blobs: 5, speed: 1, paused: false },
    controls: [
      speed,
      number("spacing", "Spacing", 5, 30, 1),
      number("blobs", "Blobs", 1, 10, 1),
      paused,
    ],
  },
  "pixel-perfect-dither-field": {
    name: "Dither Field",
    defaults: { spacing: 7, blobScale: 1, speed: 1, paused: false },
    controls: [
      speed,
      number("spacing", "Spacing", 4, 20, 1),
      number("blobScale", "Blob scale", 0.1, 3, 0.1),
      paused,
    ],
  },
};

/** Bound direct factory callers as well as persisted picker settings. */
export function normalizePixelPerfectConfig(
  id: PixelPerfectId,
  input: PixelPerfectConfig,
): PixelPerfectConfig {
  const definition = PIXEL_PERFECT_DEFINITIONS[id];
  const config = { ...definition.defaults };
  for (const control of definition.controls) {
    const value = input[control.key];
    if (
      control.type === "number" &&
      typeof value === "number" &&
      Number.isFinite(value)
    ) {
      config[control.key] = Math.max(control.min, Math.min(control.max, value));
    } else if (control.type === "boolean" && typeof value === "boolean")
      config[control.key] = value;
  }
  return config;
}
