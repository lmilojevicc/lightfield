// Paper Shaders 0.0.80 Apache-2.0. Exact effect defaults and official documentation bounds.
// Source: pinned React wrappers/docs; no React runtime. Fit is application-owned.
import type {
  BackgroundControl,
  BackgroundControlValue,
} from "./control-types";
export type ImageFilterControl =
  | BackgroundControl
  | {
      type: "color";
      key: string;
      label: string;
      advanced?: boolean;
      disabledWhen?: never;
      hiddenWhen?: never;
    };
export interface ImageFilterDefinition {
  name: string;
  defaults: Record<string, BackgroundControlValue>;
  controls: readonly ImageFilterControl[];
  noise: boolean;
  mipmaps: readonly string[];
  enums: Record<string, readonly string[]>;
  enumBase: number;
}
export const PAPER_IMAGE_FILTER_IDS = [
  "paper-image-paper-texture",
  "paper-image-fluted-glass",
  "paper-image-water",
  "paper-image-image-dithering",
  "paper-image-halftone-dots",
  "paper-image-halftone-cmyk",
  "paper-image-lens-distortion",
] as const;
export type PaperImageFilterId = (typeof PAPER_IMAGE_FILTER_IDS)[number];

const filterDefinitions = {
  "paper-image-paper-texture": {
    name: "Paper Texture",
    defaults: {
      colorFront: "#9fadbc",
      colorBack: "#ffffff",
      contrast: 0.3,
      roughness: 0.4,
      fiber: 0.3,
      fiberSize: 0.2,
      crumples: 0.3,
      foldCount: 5,
      folds: 0.65,
      fade: 0,
      crumpleSize: 0.35,
      drops: 0.2,
      seed: 5.8,
    },
    controls: [
      {
        key: "contrast",
        label: "Contrast",
        type: "number",
        advanced: false,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "roughness",
        label: "Roughness",
        type: "number",
        advanced: false,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "folds",
        label: "Folds",
        type: "number",
        advanced: false,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "colorFront",
        label: "Color front",
        type: "color",
        advanced: true,
      },
      { key: "colorBack", label: "Color back", type: "color", advanced: true },
      {
        key: "fiber",
        label: "Fiber",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "fiberSize",
        label: "Fiber size",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "crumples",
        label: "Crumples",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "foldCount",
        label: "Fold count",
        type: "number",
        advanced: true,
        min: 1.0,
        max: 15.0,
        step: 1.0,
      },
      {
        key: "fade",
        label: "Fade",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "crumpleSize",
        label: "Crumple size",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "drops",
        label: "Drops",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "seed",
        label: "Seed",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1000.0,
        step: 0.01,
      },
    ],
    noise: true,
    mipmaps: ["u_image"],
    enums: {},
    enumBase: 0,
  },
  "paper-image-fluted-glass": {
    name: "Fluted Glass",
    defaults: {
      colorBack: "#00000000",
      colorShadow: "#000000",
      colorHighlight: "#ffffff",
      shadows: 0.25,
      size: 0.5,
      angle: 0,
      distortion: 0.5,
      shift: 0,
      blur: 0,
      edges: 0.25,
      margin: 0,
      marginLeft: 0,
      marginRight: 0,
      marginTop: 0,
      marginBottom: 0,
      stretch: 0,
      distortionShape: "prism",
      highlights: 0.1,
      shape: "lines",
      grainMixer: 0,
      grainOverlay: 0,
    },
    controls: [
      {
        key: "size",
        label: "Size",
        type: "number",
        advanced: false,
        min: 0.0,
        max: 1.0,
        step: 0.001,
      },
      {
        key: "distortion",
        label: "Distortion",
        type: "number",
        advanced: false,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "shape",
        label: "Shape",
        type: "select",
        advanced: false,
        options: [
          { value: "lines", label: "lines" },
          { value: "linesIrregular", label: "linesIrregular" },
          { value: "wave", label: "wave" },
          { value: "zigzag", label: "zigzag" },
          { value: "pattern", label: "pattern" },
        ],
      },
      { key: "colorBack", label: "Color back", type: "color", advanced: true },
      {
        key: "colorShadow",
        label: "Color shadow",
        type: "color",
        advanced: true,
      },
      {
        key: "colorHighlight",
        label: "Color highlight",
        type: "color",
        advanced: true,
      },
      {
        key: "shadows",
        label: "Shadows",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "angle",
        label: "Angle",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 180.0,
        step: 0.01,
      },
      {
        key: "shift",
        label: "Shift",
        type: "number",
        advanced: true,
        min: -1.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "blur",
        label: "Blur",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "edges",
        label: "Edges",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "margin",
        label: "Margin",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "marginLeft",
        label: "Margin left",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "marginRight",
        label: "Margin right",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "marginTop",
        label: "Margin top",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "marginBottom",
        label: "Margin bottom",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "stretch",
        label: "Stretch",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "distortionShape",
        label: "Distortion shape",
        type: "select",
        advanced: true,
        options: [
          { value: "prism", label: "prism" },
          { value: "lens", label: "lens" },
          { value: "contour", label: "contour" },
          { value: "cascade", label: "cascade" },
          { value: "flat", label: "flat" },
        ],
      },
      {
        key: "highlights",
        label: "Highlights",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "grainMixer",
        label: "Grain mixer",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "grainOverlay",
        label: "Grain overlay",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
    ],
    noise: false,
    mipmaps: ["u_image"],
    enums: {
      shape: ["lines", "linesIrregular", "wave", "zigzag", "pattern"],
      distortionShape: ["prism", "lens", "contour", "cascade", "flat"],
    },
    enumBase: 1,
  },
  "paper-image-water": {
    name: "Water",
    defaults: {
      colorBack: "#909090",
      colorHighlight: "#ffffff",
      highlights: 0.07,
      layering: 0.5,
      edges: 0.8,
      caustic: 0.1,
      waves: 0.3,
      size: 1,
      speed: 1,
    },
    controls: [
      {
        key: "caustic",
        label: "Caustic",
        type: "number",
        advanced: false,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "waves",
        label: "Waves",
        type: "number",
        advanced: false,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "size",
        label: "Size",
        type: "number",
        advanced: false,
        min: 0.01,
        max: 7.0,
        step: 0.01,
      },
      {
        key: "speed",
        label: "Speed",
        type: "number",
        min: -2,
        max: 2,
        step: 0.05,
      },
      { key: "colorBack", label: "Color back", type: "color", advanced: true },
      {
        key: "colorHighlight",
        label: "Color highlight",
        type: "color",
        advanced: true,
      },
      {
        key: "highlights",
        label: "Highlights",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "layering",
        label: "Layering",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "edges",
        label: "Edges",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
    ],
    noise: false,
    mipmaps: ["u_image"],
    enums: {},
    enumBase: 0,
  },
  "paper-image-image-dithering": {
    name: "Image Dithering",
    defaults: {
      colorFront: "#94ffaf",
      colorBack: "#000c38",
      colorHighlight: "#eaff94",
      type: "8x8",
      size: 2,
      colorSteps: 2,
      originalColors: false,
      inverted: false,
    },
    controls: [
      {
        key: "type",
        label: "Type",
        type: "select",
        advanced: false,
        options: [
          { value: "random", label: "random" },
          { value: "2x2", label: "2x2" },
          { value: "4x4", label: "4x4" },
          { value: "8x8", label: "8x8" },
        ],
      },
      {
        key: "size",
        label: "Size",
        type: "number",
        advanced: false,
        min: 0.5,
        max: 20.0,
        step: 0.01,
      },
      {
        key: "originalColors",
        label: "Original colors",
        type: "boolean",
        advanced: false,
      },
      {
        key: "colorFront",
        label: "Color front",
        type: "color",
        advanced: true,
      },
      { key: "colorBack", label: "Color back", type: "color", advanced: true },
      {
        key: "colorHighlight",
        label: "Color highlight",
        type: "color",
        advanced: true,
      },
      {
        key: "colorSteps",
        label: "Color steps",
        type: "number",
        advanced: true,
        min: 1.0,
        max: 7.0,
        step: 1.0,
      },
      { key: "inverted", label: "Inverted", type: "boolean", advanced: true },
    ],
    noise: false,
    mipmaps: [],
    enums: { type: ["random", "2x2", "4x4", "8x8"] },
    enumBase: 1,
  },
  "paper-image-halftone-dots": {
    name: "Halftone Dots",
    defaults: {
      colorFront: "#2b2b2b",
      colorBack: "#f2f1e8",
      size: 0.5,
      grid: "hex",
      radius: 1.25,
      contrast: 0.4,
      originalColors: false,
      inverted: false,
      grainMixer: 0.2,
      grainOverlay: 0.2,
      grainSize: 0.5,
      type: "gooey",
    },
    controls: [
      {
        key: "size",
        label: "Size",
        type: "number",
        advanced: false,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "radius",
        label: "Radius",
        type: "number",
        advanced: false,
        min: 0.0,
        max: 2.0,
        step: 0.01,
      },
      {
        key: "type",
        label: "Type",
        type: "select",
        advanced: false,
        options: [
          { value: "classic", label: "classic" },
          { value: "gooey", label: "gooey" },
          { value: "holes", label: "holes" },
          { value: "soft", label: "soft" },
        ],
      },
      {
        key: "colorFront",
        label: "Color front",
        type: "color",
        advanced: true,
      },
      { key: "colorBack", label: "Color back", type: "color", advanced: true },
      {
        key: "grid",
        label: "Grid",
        type: "select",
        advanced: true,
        options: [
          { value: "square", label: "square" },
          { value: "hex", label: "hex" },
        ],
      },
      {
        key: "contrast",
        label: "Contrast",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "originalColors",
        label: "Original colors",
        type: "boolean",
        advanced: true,
      },
      { key: "inverted", label: "Inverted", type: "boolean", advanced: true },
      {
        key: "grainMixer",
        label: "Grain mixer",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "grainOverlay",
        label: "Grain overlay",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "grainSize",
        label: "Grain size",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
    ],
    noise: false,
    mipmaps: [],
    enums: {
      grid: ["square", "hex"],
      type: ["classic", "gooey", "holes", "soft"],
    },
    enumBase: 0,
  },
  "paper-image-halftone-cmyk": {
    name: "Halftone CMYK",
    defaults: {
      colorBack: "#fbfaf5",
      colorC: "#00b4ff",
      colorM: "#fc519f",
      colorY: "#ffd800",
      colorK: "#231f20",
      size: 0.2,
      contrast: 1,
      softness: 1,
      grainSize: 0.5,
      grainMixer: 0,
      grainOverlay: 0,
      gridNoise: 0.2,
      floodC: 0.15,
      floodM: 0,
      floodY: 0,
      floodK: 0,
      gainC: 0.3,
      gainM: 0,
      gainY: 0.2,
      gainK: 0,
      type: "ink",
    },
    controls: [
      {
        key: "size",
        label: "Size",
        type: "number",
        advanced: false,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "contrast",
        label: "Contrast",
        type: "number",
        advanced: false,
        min: 0.0,
        max: 2.0,
        step: 0.01,
      },
      {
        key: "type",
        label: "Type",
        type: "select",
        advanced: false,
        options: [
          { value: "dots", label: "dots" },
          { value: "ink", label: "ink" },
          { value: "sharp", label: "sharp" },
        ],
      },
      { key: "colorBack", label: "Color back", type: "color", advanced: true },
      { key: "colorC", label: "Color c", type: "color", advanced: true },
      { key: "colorM", label: "Color m", type: "color", advanced: true },
      { key: "colorY", label: "Color y", type: "color", advanced: true },
      { key: "colorK", label: "Color k", type: "color", advanced: true },
      {
        key: "softness",
        label: "Softness",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "grainSize",
        label: "Grain size",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "grainMixer",
        label: "Grain mixer",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "grainOverlay",
        label: "Grain overlay",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "gridNoise",
        label: "Grid noise",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "floodC",
        label: "Flood c",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "floodM",
        label: "Flood m",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "floodY",
        label: "Flood y",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "floodK",
        label: "Flood k",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "gainC",
        label: "Gain c",
        type: "number",
        advanced: true,
        min: -1.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "gainM",
        label: "Gain m",
        type: "number",
        advanced: true,
        min: -1.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "gainY",
        label: "Gain y",
        type: "number",
        advanced: true,
        min: -1.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "gainK",
        label: "Gain k",
        type: "number",
        advanced: true,
        min: -1.0,
        max: 1.0,
        step: 0.01,
      },
    ],
    noise: true,
    mipmaps: [],
    enums: { type: ["dots", "ink", "sharp"] },
    enumBase: 0,
  },
  "paper-image-lens-distortion": {
    name: "Lens Distortion",
    defaults: {
      spread: 0.6,
      bias: 1,
      angle: 0,
      perspective: 0.1,
      count: 35,
      dispersion: 1,
      dispersionShift: 0,
      dispersionColor: 0.6,
      focusCenter: 0.8,
      focusEdges: 1,
      swirl: 0.35,
      noise: 0,
      noiseFrequency: 0.25,
      noiseOffset: 0,
      lensBulge: 0,
      lensCircle: 0,
      grainMixer: 0,
      grainOverlay: 0,
      imageX: 0,
      imageY: 0,
    },
    controls: [
      {
        key: "spread",
        label: "Spread",
        type: "number",
        advanced: false,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "count",
        label: "Count",
        type: "number",
        advanced: false,
        min: 2.0,
        max: 50.0,
        step: 1.0,
      },
      {
        key: "lensBulge",
        label: "Lens bulge",
        type: "number",
        advanced: false,
        min: -1.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "bias",
        label: "Bias",
        type: "number",
        advanced: true,
        min: -1.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "angle",
        label: "Angle",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 360.0,
        step: 0.01,
      },
      {
        key: "perspective",
        label: "Perspective",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "dispersion",
        label: "Dispersion",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "dispersionShift",
        label: "Dispersion shift",
        type: "number",
        advanced: true,
        min: -1.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "dispersionColor",
        label: "Dispersion color",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "focusCenter",
        label: "Focus center",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "focusEdges",
        label: "Focus edges",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "swirl",
        label: "Swirl",
        type: "number",
        advanced: true,
        min: -1.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "noise",
        label: "Noise",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "noiseFrequency",
        label: "Noise frequency",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "noiseOffset",
        label: "Noise offset",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "lensCircle",
        label: "Lens circle",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "grainMixer",
        label: "Grain mixer",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "grainOverlay",
        label: "Grain overlay",
        type: "number",
        advanced: true,
        min: 0.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "imageX",
        label: "Image x",
        type: "number",
        advanced: true,
        min: -1.0,
        max: 1.0,
        step: 0.01,
      },
      {
        key: "imageY",
        label: "Image y",
        type: "number",
        advanced: true,
        min: -1.0,
        max: 1.0,
        step: 0.01,
      },
    ],
    noise: false,
    mipmaps: ["u_image"],
    enums: {},
    enumBase: 0,
  },
} as const satisfies Record<PaperImageFilterId, ImageFilterDefinition>;

/** Persistable scalar parameters from Paper 0.0.80, with sizing/image/motion omitted.
 * Water alone retains speed. Select unions come from the official enum metadata.
 * Normalization persists only validated exposed controls, matching the source registry.
 */
type ImageFilterParams = {
  [Id in PaperImageFilterId]: {
    -readonly [
      Key in keyof (typeof filterDefinitions)[Id]["defaults"]
    ]?: (typeof filterDefinitions)[Id]["defaults"][Key] extends number
      ? number
      : (typeof filterDefinitions)[Id]["defaults"][Key] extends boolean
        ? boolean
        : Key extends keyof (typeof filterDefinitions)[Id]["enums"]
          ? (typeof filterDefinitions)[Id]["enums"][Key] extends readonly string[]
            ? (typeof filterDefinitions)[Id]["enums"][Key][number]
            : never
          : string;
  };
};
export type ImageFilterOverrides = {
  [K in PaperImageFilterId]?: ImageFilterParams[K];
};
export const PAPER_IMAGE_FILTERS: Record<
  PaperImageFilterId,
  ImageFilterDefinition
> = filterDefinitions;
export function isPaperImageFilter(
  value: unknown,
): value is PaperImageFilterId {
  return typeof value === "string" && Object.hasOwn(PAPER_IMAGE_FILTERS, value);
}
export function normalizeImageFilterOverrides(
  id: PaperImageFilterId,
  value: unknown,
): Record<string, BackgroundControlValue> {
  const input = value && typeof value === "object" ? value : {};
  const result: Record<string, BackgroundControlValue> = {};
  const definition = PAPER_IMAGE_FILTERS[id];
  for (const control of definition.controls) {
    let v: unknown = Reflect.get(input, control.key);
    if (control.type === "number") {
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      const bounded = Math.max(control.min, Math.min(control.max, v));
      v = control.step === 1 ? Math.round(bounded) : bounded;
    } else if (control.type === "boolean") {
      if (typeof v !== "boolean") continue;
    } else if (control.type === "color") {
      if (typeof v !== "string" || !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v))
        continue;
    } else if (
      typeof v !== "string" ||
      !control.options.some((o) => o.value === v)
    )
      continue;
    // A side explicitly set to zero must still override a nonzero margin shorthand.
    const margin: unknown = Reflect.get(input, "margin");
    const marginSide =
      id === "paper-image-fluted-glass" &&
      /^margin(Left|Right|Top|Bottom)$/.test(control.key) &&
      typeof margin === "number" &&
      Number.isFinite(margin) &&
      margin > 0;
    if (v !== definition.defaults[control.key] || marginSide)
      if (
        typeof v === "number" ||
        typeof v === "boolean" ||
        typeof v === "string"
      )
        result[control.key] = v;
  }
  return result;
}
export function normalizeImageFilterMap(value: unknown): ImageFilterOverrides {
  const input = value && typeof value === "object" ? value : {};
  const result: ImageFilterOverrides = {};
  for (const id of PAPER_IMAGE_FILTER_IDS) {
    const config = normalizeImageFilterOverrides(id, Reflect.get(input, id));
    if (Object.keys(config).length) result[id] = config;
  }
  return result;
}
export function effectiveImageFilter(
  id: PaperImageFilterId,
  overrides: ImageFilterOverrides,
) {
  return {
    ...PAPER_IMAGE_FILTERS[id].defaults,
    ...normalizeImageFilterOverrides(id, overrides[id]),
  };
}
