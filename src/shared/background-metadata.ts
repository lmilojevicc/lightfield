import {
  PIXEL_PERFECT_IDS,
  PIXEL_PERFECT_DEFINITIONS,
} from "./pixel-perfect-metadata";
import {
  NEAT_PRESET_IDS,
  NEAT_PRESET_NAMES,
  NEAT_PRESET_DEFINITIONS,
} from "./neat-preset-metadata";
// Background catalog. Per-collection provenance and licenses are documented in
// THIRD_PARTY_NOTICES.md; Paper Shaders uses Apache-2.0, not React Bits terms.

// Pure family metadata is independent of native engine implementations.
import { NEAT_DEFAULTS, NEAT_CONTROLS } from "./neat-metadata";
import { PAPER_BACKGROUND_IDS, PAPER_DEFINITIONS } from "./paper-metadata";
export { PAPER_BACKGROUND_IDS } from "./paper-metadata";
import { ORBS_DEFAULT_SCALE_PCT } from "./orbs-metadata";

export const BACKGROUND_IDS = [
  "none",
  "local-image",
  "side-rays",
  "soft-aurora",
  "waves",
  "shape-blur",
  "prism",
  "plasma",
  "pixel-blast",
  "liquid-chrome",
  "light-rays",
  "iridescence",
  "grainient",
  "gradient-blinds",
  "dot-field",
  "dither",
  "dark-veil",
  "aurora",
  "strands",
  "gradient-waves",
  "beams",
  "seamlessBeams",
  "line-waves",
  "silk",
  "liquid-ether",
  "ferrofluid",
  "ascii",
  "topo",
  "halftone",
  "ripple",
  "smoke",
  "fractal",
  "ray",
  "ink",
  "dither-sky",
  "julia",
  "orbs-working",
  "orbs-searching",
  "orbs-solving",
  "orbs-listening",
  "orbs-connecting",
  "orbs-weaving",
  "orbs-composing",
  "orbs-breathing",
  "orbs-shaping",
  "neat-gradient",
  ...NEAT_PRESET_IDS,
  ...PAPER_BACKGROUND_IDS,
  ...PIXEL_PERFECT_IDS,
] as const;

export type BackgroundId = (typeof BACKGROUND_IDS)[number];
/** Source settings default (config.ts); selection IDs are never renamed with app branding. */
export const DEFAULT_BACKGROUND_ID = "ink" satisfies BackgroundId;
export type BackgroundImplementationId = Exclude<
  BackgroundId,
  "none" | "local-image"
>;
export const BACKGROUND_IMPLEMENTATION_IDS: readonly BackgroundImplementationId[] =
  BACKGROUND_IDS.filter((id) => id !== "none" && id !== "local-image");
export type {
  BackgroundControlValue,
  BackgroundControl,
  NumberControl,
  BooleanControl,
  SelectControl,
} from "./control-types";
import type {
  BackgroundControlValue,
  BackgroundControl,
  NumberControl,
  BaseControl,
} from "./control-types";
export type BackgroundOverrides = Partial<
  Record<BackgroundId, Record<string, BackgroundControlValue>>
>;

export interface BackgroundDescriptor {
  id: BackgroundId;
  name: string;
  available: boolean;
  defaults: Readonly<Record<string, BackgroundControlValue>>;
  controls: readonly BackgroundControl[];
}

export interface BackgroundCollection {
  id: string;
  name: string;
  /** Optional credit line rendered in the picker. */
  attribution?: string;
  /** Optional canonical link rendered in the picker. */
  link?: { href: string; label: string };
  ids: readonly BackgroundId[];
}

/** First-party effects grouped in the Lightfield collection. */
const LIGHTFIELD_BACKGROUND_IDS = [
  "ascii",
  "topo",
  "halftone",
  "ripple",
  "smoke",
  "fractal",
  "ray",
  "ink",
  "dither-sky",
  "julia",
] as const;

/** Standalone upstream-attributed collection: one background per Thinking Orbs state. */
const ORBS_BACKGROUND_IDS = [
  "orbs-working",
  "orbs-searching",
  "orbs-solving",
  "orbs-listening",
  "orbs-connecting",
  "orbs-weaving",
  "orbs-composing",
  "orbs-breathing",
  "orbs-shaping",
] as const;

/** Lightfield and upstream Orbs/Neat/Paper/Pixel Perfect IDs excluded from the React Bits collection. */
const NON_REACT_BITS_BACKGROUND_IDS = [
  ...PAPER_BACKGROUND_IDS,
  ...PIXEL_PERFECT_IDS,
  ...LIGHTFIELD_BACKGROUND_IDS,
  ...ORBS_BACKGROUND_IDS,
  "neat-gradient",
  ...NEAT_PRESET_IDS,
] as const;

const nonReactBitsIds = new Set<string>(NON_REACT_BITS_BACKGROUND_IDS);

/** The bundled collection: React Bits effects grouped under their upstream attribution. */
export const REACT_BITS_COLLECTION: BackgroundCollection = {
  id: "react-bits",
  name: "React Bits",
  attribution: "Adapted from React Bits by David Haz (MIT + Commons Clause).",
  link: {
    href: "https://github.com/DavidHDev/react-bits",
    label: "View React Bits",
  },
  ids: BACKGROUND_IMPLEMENTATION_IDS.filter(
    (id): id is BackgroundImplementationId => !nonReactBitsIds.has(id),
  ),
};

export const ORBS_COLLECTION: BackgroundCollection = {
  id: "orbs",
  name: "Orbs",
  attribution:
    "Uses Thinking Orbs engine by Jakub Antalík (MIT), with theme/lifecycle adapter.",
  link: {
    href: "https://github.com/Jakubantalik/Libraries",
    label: "View Jakub Antalík",
  },
  ids: ORBS_BACKGROUND_IDS,
};

export const NEAT_COLLECTION: BackgroundCollection = {
  id: "neat",
  name: "Neat",
  attribution: "Neat Gradient by FireCMS.",
  link: { href: "https://neat.firecms.co", label: "View Neat by FireCMS" },
  ids: ["neat-gradient", ...NEAT_PRESET_IDS],
};

export const LIGHTFIELD_COLLECTION: BackgroundCollection = {
  // Collection/effect IDs retain source semantics even though the application is lightfield.
  id: "meridian",
  name: "lightfield",
  ids: LIGHTFIELD_BACKGROUND_IDS,
};

export const PAPER_COLLECTION: BackgroundCollection = {
  id: "paper",
  name: "Paper Shaders",
  attribution: "Powered by Paper Shaders (Apache-2.0).",
  link: { href: "https://shaders.paper.design/", label: "View Paper Shaders" },
  ids: PAPER_BACKGROUND_IDS,
};

export const PIXEL_PERFECT_COLLECTION: BackgroundCollection = {
  id: "pixel-perfect",
  name: "Pixel Perfect",
  attribution: "Adapted from Pixel Perfect by Vansh Nagar.",
  link: {
    href: "https://www.pixel-perfect.space/blocks/backgrounds",
    label: "View Pixel Perfect",
  },
  ids: PIXEL_PERFECT_IDS,
};

/** Registry order matches newtab.html. */
export const BACKGROUND_COLLECTIONS: readonly BackgroundCollection[] = [
  { id: "personal", name: "Personal", ids: ["none", "local-image"] },
  REACT_BITS_COLLECTION,
  ORBS_COLLECTION,
  LIGHTFIELD_COLLECTION,
  NEAT_COLLECTION,
  PAPER_COLLECTION,
  PIXEL_PERFECT_COLLECTION,
];

const number = (
  key: string,
  label: string,
  min: number,
  max: number,
  step: number,
  disabledWhen?: BaseControl["disabledWhen"],
): NumberControl => ({
  key,
  label,
  type: "number",
  min,
  max,
  step,
  ...(disabledWhen ? { disabledWhen } : {}),
});

const sideRaysControls: readonly BackgroundControl[] = [
  number("speed", "Speed", 0.1, 5, 0.1),
  number("intensity", "Intensity", 0.1, 3, 0.1),
  number("spread", "Spread", 0.1, 3, 0.1),
  {
    key: "origin",
    label: "Origin",
    type: "select",
    options: [
      { value: "top-right", label: "Top Right" },
      { value: "top-left", label: "Top Left" },
      { value: "bottom-right", label: "Bottom Right" },
      { value: "bottom-left", label: "Bottom Left" },
    ],
  },
  number("tilt", "Tilt", -60, 60, 1),
  number("saturation", "Saturation", 0, 2, 0.05),
  number("blend", "Blend", 0, 1, 0.01),
  number("falloff", "Falloff", 0.5, 4, 0.1),
  number("opacity", "Opacity", 0, 1, 0.05),
];

const wavesControls: readonly BackgroundControl[] = [
  number("waveSpeedX", "Wave Speed X", 0, 0.1, 0.01),
];

const shapeBlurControls: readonly BackgroundControl[] = [
  number("shapeSize", "Shape Size", 0.1, 2, 0.1),
  number("roundness", "Roundness", 0, 1, 0.05),
  number("borderSize", "Border Size", 0.01, 0.2, 0.005),
  number("circleSize", "Circle Size", 0.1, 0.5, 0.01),
  number("circleEdge", "Circle Edge", 0.1, 2, 0.1),
];

const pixelBlastControls: readonly BackgroundControl[] = [
  {
    key: "variant",
    label: "Variant",
    type: "select",
    options: [
      { value: "square", label: "Square" },
      { value: "circle", label: "Circle" },
      { value: "triangle", label: "Triangle" },
      { value: "diamond", label: "Diamond" },
    ],
  },
  number("pixelSize", "Pixel Size", 1, 5, 1),
  number("patternScale", "Pattern Scale", 0.25, 8, 0.25),
  number("patternDensity", "Pattern Density", 0, 2, 0.05),
  number("pixelSizeJitter", "Pixel Jitter", 0, 2, 0.05),
  number("speed", "Speed", 0, 3, 0.05),
  number("edgeFade", "Edge Fade", 0, 0.5, 0.01),
  { key: "enableRipples", label: "Ripples", type: "boolean" },
  { key: "liquid", label: "Liquid", type: "boolean" },
];

const prismControls: readonly BackgroundControl[] = [
  {
    key: "animationType",
    label: "Animation Type",
    type: "select",
    options: [
      { value: "rotate", label: "Rotate" },
      { value: "hover", label: "Hover" },
      { value: "3drotate", label: "3D Rotate" },
    ],
  },
  number("timeScale", "Time Scale", 0.1, 2, 0.1),
  number("scale", "Scale", 1, 5, 0.1),
  number("height", "Height", 1, 8, 0.1),
  number("baseWidth", "Base Width", 1, 10, 0.1),
  number("noise", "Noise", 0, 1, 0.05),
  number("glow", "Glow", 0, 3, 0.1),
  number("hueShift", "Hue Shift", -3.1416, 3.1416, 0.1),
  number("colorFrequency", "Color Frequency", 0.25, 4, 0.05),
];

const plasmaControls: readonly BackgroundControl[] = [
  {
    key: "direction",
    label: "Direction",
    type: "select",
    options: [
      { value: "forward", label: "Forward" },
      { value: "reverse", label: "Reverse" },
      { value: "pingpong", label: "Ping Pong" },
    ],
  },
  number("speed", "Speed", 0.1, 3, 0.1),
  number("scale", "Scale", 0.5, 3, 0.1),
  number("opacity", "Opacity", 0.1, 1, 0.1),
  number("iterations", "Iterations", 10, 80, 5),
  number("renderScale", "Render Scale", 0.2, 1, 0.05),
  number("targetFps", "Target FPS", 10, 60, 5),
  number("maxDpr", "Max DPR", 0.5, 3, 0.5),
  { key: "mouseInteractive", label: "Mouse Interactive", type: "boolean" },
];

const liquidChromeControls: readonly BackgroundControl[] = [
  number("speed", "Speed", 0, 5, 0.01),
  number("amplitude", "Amplitude", 0.1, 1, 0.01),
  { key: "interactive", label: "Enable Interaction", type: "boolean" },
];

const iridescenceControls: readonly BackgroundControl[] = [
  number("speed", "Speed", 0, 2, 0.1),
  { key: "mouseReact", label: "Enable Mouse Interaction", type: "boolean" },
];

const darkVeilControls: readonly BackgroundControl[] = [
  number("speed", "Speed", 0, 3, 0.1),
  number("hueShift", "Hue Shift", 0, 360, 1),
  number("noiseIntensity", "Noise Intensity", 0, 0.2, 0.01),
  number("scanlineFrequency", "Scanline Frequency", 0.5, 5, 0.1),
  number("scanlineIntensity", "Scanline Intensity", 0, 1, 0.01),
  number("warpAmount", "Warp Amount", 0, 5, 0.1),
];

const dotFieldControls: readonly BackgroundControl[] = [
  number("dotRadius", "Dot Radius", 0.5, 5, 0.5),
  number("dotSpacing", "Dot Spacing", 5, 30, 1),
  number("cursorRadius", "Cursor Radius", 100, 1000, 50),
  number("cursorForce", "Cursor Force", 0, 1, 0.01),
  { key: "bulgeOnly", label: "Bulge Only", type: "boolean" },
  number("bulgeStrength", "Bulge Strength", 0, 150, 1),
  number("glowRadius", "Glow Radius", 50, 400, 10),
  number("waveAmplitude", "Wave Amplitude", 0, 20, 1),
  { key: "sparkle", label: "Sparkle", type: "boolean" },
];

const softAuroraControls: readonly BackgroundControl[] = [
  number("speed", "Speed", 0.1, 5, 0.1),
  number("scale", "Scale", 0.1, 3, 0.1),
  number("brightness", "Brightness", 0.1, 3, 0.1),
  number("noiseFrequency", "Noise Frequency", 0.5, 10, 0.5),
  number("noiseAmplitude", "Noise Amplitude", 0.5, 10, 0.5),
  number("bandHeight", "Band Height", 0, 1, 0.05),
  number("bandSpread", "Band Spread", 0.1, 3, 0.1),
  number("octaveDecay", "Octave Decay", 0.01, 0.5, 0.01),
  number("layerOffset", "Layer Offset", 0, 1, 0.05),
  number("colorSpeed", "Color Speed", 0.1, 5, 0.1),
  {
    key: "enableMouseInteraction",
    label: "Mouse Interaction",
    type: "boolean",
  },
  {
    ...number("mouseInfluence", "Mouse Influence", 0.1, 1, 0.05),
    hiddenWhen: { key: "enableMouseInteraction", equals: false },
  },
];

const lightRaysControls: readonly BackgroundControl[] = [
  {
    key: "raysOrigin",
    label: "Rays Origin",
    type: "select",
    options: [
      { value: "top-center", label: "Top" },
      { value: "right", label: "Right" },
      { value: "left", label: "Left" },
      { value: "bottom-center", label: "Bottom" },
    ],
  },
  number("raysSpeed", "Rays Speed", 0.1, 3, 0.1),
  number("lightSpread", "Light Spread", 0.1, 2, 0.1),
  number("rayLength", "Ray Length", 0.5, 3, 0.1),
  number("fadeDistance", "Fade Distance", 0.5, 2, 0.1),
  number("saturation", "Saturation", 0, 2, 0.1),
  number("mouseInfluence", "Mouse Influence", 0, 1, 0.1),
  number("noiseAmount", "Noise Amount", 0, 0.5, 0.01),
  number("distortion", "Distortion", 0, 1, 0.1),
  { key: "pulsating", label: "Pulsating", type: "boolean" },
];

const auroraControls: readonly BackgroundControl[] = [
  number("speed", "Speed", 0, 2, 0.1),
  number("blend", "Blend", 0, 1, 0.01),
];

const ditherControls: readonly BackgroundControl[] = [
  number("colorNum", "Color Intensity", 2.5, 40, 0.1),
  number("waveAmplitude", "Wave Amplitude", 0, 1, 0.01),
  number("waveFrequency", "Wave Frequency", 0, 10, 0.1),
  { key: "disableAnimation", label: "Disable Animation", type: "boolean" },
  number("waveSpeed", "Wave Speed", 0, 1, 0.01, {
    key: "disableAnimation",
    equals: true,
  }),
  {
    key: "enableMouseInteraction",
    label: "Mouse Interaction",
    type: "boolean",
  },
  number("mouseRadius", "Mouse Radius", 0, 2, 0.1, {
    key: "enableMouseInteraction",
    equals: false,
  }),
];

const grainientControls: readonly BackgroundControl[] = [
  number("timeSpeed", "Time Speed", 0, 5, 0.05),
  number("colorBalance", "Color Balance", -1, 1, 0.01),
  number("warpStrength", "Warp Strength", 0, 4, 0.05),
  number("warpFrequency", "Warp Frequency", 0, 12, 0.1),
  number("warpSpeed", "Warp Speed", 0, 6, 0.1),
  number("warpAmplitude", "Warp Amplitude", 5, 80, 1),
  number("blendAngle", "Blend Angle", -180, 180, 1),
  number("blendSoftness", "Blend Softness", 0, 1, 0.01),
  number("rotationAmount", "Rotation Amount", 0, 1440, 10),
  number("noiseScale", "Noise Scale", 0, 4, 0.05),
  number("grainAmount", "Grain Amount", 0, 0.4, 0.01),
  number("grainScale", "Grain Scale", 0.2, 8, 0.1),
  { key: "grainAnimated", label: "Grain Animated", type: "boolean" },
  number("contrast", "Contrast", 0, 2.5, 0.05),
  number("gamma", "Gamma", 0.4, 2.5, 0.05),
  number("saturation", "Saturation", 0, 2.5, 0.05),
  number("centerX", "Center Offset X", -1, 1, 0.01),
  number("centerY", "Center Offset Y", -1, 1, 0.01),
  number("zoom", "Zoom", 0.3, 3, 0.05),
];

const gradientBlindsControls: readonly BackgroundControl[] = [
  {
    key: "shineDirection",
    label: "Light Direction",
    type: "select",
    options: [
      { value: "left", label: "Left" },
      { value: "right", label: "Right" },
    ],
  },
  number("angle", "Blinds Angle", 0, 360, 1),
  number("noise", "Noise Amount", 0, 1, 0.01),
  number("blindCount", "Blinds Count", 1, 64, 1),
  number("blindMinWidth", "Min Blind W", 10, 200, 5),
  number("spotlightRadius", "Spot Radius", 0.05, 1, 0.05),
  number("distortAmount", "Distort", 0, 100, 1),
  number("mouseDampening", "Mouse Damp", 0, 1, 0.01),
];

const strandsControls: readonly BackgroundControl[] = [
  number("count", "Count", 1, 10, 1),
  number("speed", "Speed", 0, 3, 0.1),
  number("amplitude", "Amplitude", 0, 3, 0.1),
  number("waviness", "Waviness", 0.2, 3, 0.1),
  number("thickness", "Thickness", 0.2, 4, 0.1),
  number("glow", "Glow", 0.3, 3, 0.05),
  number("taper", "Taper", 0.5, 6, 0.1),
  number("spread", "Spread", 0, 3, 0.1),
  number("hueShift", "Hue Shift", 0, 1, 0.01),
  number("intensity", "Intensity", 0, 1, 0.05),
  number("saturation", "Saturation", 0, 2, 0.05),
  number("opacity", "Opacity", 0, 1, 0.05),
  number("scale", "Scale", 0.3, 3, 0.1),
  { key: "glass", label: "Glass Ball", type: "boolean" },
  number("refraction", "Refraction", 0, 3, 0.05, {
    key: "glass",
    equals: false,
  }),
  number("dispersion", "Dispersion", 0, 4, 0.05, {
    key: "glass",
    equals: false,
  }),
  number("glassSize", "Glass Size", 0.3, 1, 0.01, {
    key: "glass",
    equals: false,
  }),
];

const beamsControls: readonly BackgroundControl[] = [
  number("beamWidth", "Beam Width", 0.1, 10, 0.1),
  number("beamHeight", "Beam Height", 1, 25, 1),
  number("beamNumber", "Beam Count", 1, 50, 1),
  number("speed", "Speed", 0.1, 10, 0.1),
  number("noiseIntensity", "Noise Intensity", 0, 5, 0.05),
  number("scale", "Noise Scale", 0.01, 1, 0.01),
  number("rotation", "Rotation", 0, 360, 1),
];

const lineWavesControls: readonly BackgroundControl[] = [
  number("speed", "Speed", 0.1, 3, 0.1),
  number("innerLineCount", "Inner Line Count", 2, 40, 1),
  number("outerLineCount", "Outer Line Count", 2, 40, 1),
  number("warpIntensity", "Warp Intensity", 0.1, 3, 0.1),
  number("rotation", "Rotation", -180, 180, 1),
  number("edgeFadeWidth", "Edge Fade Width", 0, 1, 0.05),
  number("colorCycleSpeed", "Color Cycle Speed", 0.1, 5, 0.1),
  number("brightness", "Brightness", 0.1, 3, 0.1),
  {
    key: "enableMouseInteraction",
    label: "Mouse Interaction",
    type: "boolean",
  },
  {
    ...number("mouseInfluence", "Mouse Influence", 0.1, 2, 0.1),
    hiddenWhen: { key: "enableMouseInteraction", equals: false },
  },
];

const silkControls: readonly BackgroundControl[] = [
  number("speed", "Speed", 0.1, 20, 0.1),
  number("scale", "Scale", 0.1, 5, 0.1),
  number("noiseIntensity", "Noise Intensity", 0, 10, 0.1),
  number("rotation", "Rotation", 0, Math.PI * 2, 0.01),
];

const liquidEtherControls: readonly BackgroundControl[] = [
  number("mouseForce", "Mouse Force", 0, 60, 1),
  number("cursorSize", "Cursor Size", 10, 300, 5),
  number("resolution", "Resolution", 0.2, 0.5, 0.05),
  number("autoSpeed", "Auto Speed", 0, 1, 0.05),
  number("autoIntensity", "Auto Intensity", 0, 4, 0.1),
  number("iterationsPoisson", "Pressure", 1, 64, 1),
  { key: "isBounce", label: "Bounce Edges", type: "boolean" },
  { key: "autoDemo", label: "Auto Animate", type: "boolean" },
  { key: "isViscous", label: "Viscous", type: "boolean" },
  {
    ...number("viscous", "Viscous Coef", 1, 100, 1),
    hiddenWhen: { key: "isViscous", equals: false },
  },
  {
    ...number("iterationsViscous", "Viscous Iterations", 1, 64, 1),
    hiddenWhen: { key: "isViscous", equals: false },
  },
];

const ferrofluidControls: readonly BackgroundControl[] = [
  { key: "mouseInteraction", label: "Cursor Magnet", type: "boolean" },
  {
    key: "flowDirection",
    label: "Flow Direction",
    type: "select",
    options: [
      { value: "down", label: "Down" },
      { value: "up", label: "Up" },
      { value: "left", label: "Left" },
      { value: "right", label: "Right" },
    ],
  },
  number("speed", "Speed", 0, 3, 0.1),
  number("scale", "Scale", 0.3, 3, 0.1),
  number("turbulence", "Turbulence", 0, 2, 0.05),
  number("fluidity", "Fluidity", 0.02, 0.5, 0.01),
  number("rimWidth", "Rim Width", 0.05, 0.5, 0.01),
  number("sharpness", "Sharpness", 1, 6, 0.1),
  number("shimmer", "Shimmer", 0, 2, 0.05),
  number("glow", "Glow", 0.5, 5, 0.1),
  number("mouseStrength", "Cursor Strength", 0, 3, 0.1),
  number("mouseRadius", "Cursor Radius", 0.05, 1, 0.05),
];

const gradientWavesControls: readonly BackgroundControl[] = [
  number("speed", "Speed", 0, 2, 0.05),
  number("amplitude", "Amplitude", 0, 5, 0.05),
  number("waveScale", "Wave Scale", 0.3, 3, 0.05),
  number("waveRatio", "Wave Ratio", 0.3, 3, 0.05),
  number("swell", "Swell", 0, 40, 0.5),
  number("turbulence", "Turbulence", 0, 60, 0.5),
  number("tilt", "Tilt", 0.2, 1.3, 0.01),
  number("zoom", "Zoom", 0.4, 2.5, 0.05),
  number("height", "Horizon Height", 2, 10, 0.1),
  number("fogDepth", "Fog Depth", 5, 60, 1),
  {
    key: "detail",
    label: "Detail",
    type: "select",
    options: [
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
    ],
  },
  number("brightness", "Brightness", 0.2, 2, 0.05),
  number("opacity", "Opacity", 0, 1, 0.01),
  { key: "mouseInteraction", label: "Cursor Parallax", type: "boolean" },
  number("parallaxStrength", "Parallax Strength", 0, 1, 0.01),
  { key: "grain", label: "Grain", type: "boolean" },
  number("grainIntensity", "Grain Intensity", 0, 0.3, 0.01),
];

const lightfieldControls: readonly BackgroundControl[] = [
  number("opacity", "Opacity", 0, 1, 0.05),
  number("brightness", "Brightness", 0.5, 1.5, 0.05),
  number("saturation", "Saturation", 0, 2, 0.05),
  number("contrast", "Contrast", 0.5, 1.5, 0.05),
];

const orbsControls: readonly BackgroundControl[] = [
  ...lightfieldControls,
  number("speed", "Speed", 0.25, 3, 0.05),
  number("scale", "Scale", 10, 60, 0.1),
  number("density", "Density", 25, 200, 5),
  number("x", "X Position", -50, 50, 1),
  number("y", "Y Position", -50, 50, 1),
];

const lightfieldDefaults = (
  opacity: number,
): Readonly<Record<string, BackgroundControlValue>> => ({
  opacity,
  brightness: 1,
  saturation: 1,
  contrast: 1,
});

const orbsDefaults = (): Readonly<Record<string, BackgroundControlValue>> => ({
  ...lightfieldDefaults(1),
  speed: 1,
  scale: ORBS_DEFAULT_SCALE_PCT,
  density: 100,
  x: 0,
  y: 0,
});

const implementations: Record<
  BackgroundImplementationId,
  Omit<BackgroundDescriptor, "id" | "name" | "available">
> = {
  ...PAPER_DEFINITIONS,
  ...PIXEL_PERFECT_DEFINITIONS,
  "side-rays": {
    defaults: {
      speed: 2.5,
      intensity: 2,
      spread: 2,
      origin: "top-right",
      tilt: 0,
      saturation: 1.5,
      blend: 0.75,
      falloff: 1.6,
      opacity: 1,
    },
    controls: sideRaysControls,
  },
  "soft-aurora": {
    defaults: {
      speed: 0.6,
      scale: 1.5,
      brightness: 1,
      noiseFrequency: 2.5,
      noiseAmplitude: 1,
      bandHeight: 0.5,
      bandSpread: 1,
      octaveDecay: 0.1,
      layerOffset: 0,
      colorSpeed: 1,
      enableMouseInteraction: true,
      mouseInfluence: 0.25,
    },
    controls: softAuroraControls,
  },
  waves: { defaults: { waveSpeedX: 0.0125 }, controls: wavesControls },
  "shape-blur": {
    defaults: {
      shapeSize: 1,
      roundness: 0.5,
      borderSize: 0.05,
      circleSize: 0.25,
      circleEdge: 1,
    },
    controls: shapeBlurControls,
  },
  prism: {
    defaults: {
      animationType: "rotate",
      timeScale: 0.5,
      scale: 3.6,
      height: 3.5,
      baseWidth: 5.5,
      noise: 0,
      glow: 1,
      hueShift: 0,
      colorFrequency: 1,
    },
    controls: prismControls,
  },
  plasma: {
    defaults: {
      direction: "forward",
      speed: 1,
      scale: 1,
      opacity: 1,
      iterations: 60,
      renderScale: 0.55,
      targetFps: 60,
      maxDpr: 1.5,
      mouseInteractive: false,
    },
    controls: plasmaControls,
  },
  "pixel-blast": {
    defaults: {
      variant: "square",
      pixelSize: 4,
      patternScale: 2,
      patternDensity: 1,
      pixelSizeJitter: 0,
      speed: 0.5,
      edgeFade: 0.25,
      enableRipples: true,
      liquid: false,
    },
    controls: pixelBlastControls,
  },
  "liquid-chrome": {
    defaults: { speed: 0.3, amplitude: 0.3, interactive: true },
    controls: liquidChromeControls,
  },
  "light-rays": {
    defaults: {
      raysOrigin: "top-center",
      raysSpeed: 1,
      lightSpread: 0.5,
      rayLength: 3,
      fadeDistance: 1,
      saturation: 1,
      mouseInfluence: 0.1,
      noiseAmount: 0,
      distortion: 0,
      pulsating: false,
    },
    controls: lightRaysControls,
  },
  iridescence: {
    defaults: { speed: 1, mouseReact: true },
    controls: iridescenceControls,
  },
  "dot-field": {
    defaults: {
      dotRadius: 1.5,
      dotSpacing: 14,
      cursorRadius: 500,
      cursorForce: 0.1,
      bulgeOnly: true,
      bulgeStrength: 67,
      glowRadius: 160,
      waveAmplitude: 0,
      sparkle: false,
    },
    controls: dotFieldControls,
  },
  dither: {
    defaults: {
      mouseRadius: 0.3,
      colorNum: 4,
      waveAmplitude: 0.3,
      waveFrequency: 3,
      waveSpeed: 0.05,
      enableMouseInteraction: true,
      disableAnimation: false,
    },
    controls: ditherControls,
  },
  "dark-veil": {
    defaults: {
      speed: 0.5,
      hueShift: 0,
      noiseIntensity: 0,
      scanlineFrequency: 0,
      scanlineIntensity: 0,
      warpAmount: 0,
    },
    controls: darkVeilControls,
  },
  aurora: { defaults: { speed: 1, blend: 0.5 }, controls: auroraControls },
  grainient: {
    defaults: {
      timeSpeed: 0.25,
      colorBalance: 0,
      warpStrength: 1,
      warpFrequency: 5,
      warpSpeed: 2,
      warpAmplitude: 50,
      blendAngle: 0,
      blendSoftness: 0.05,
      rotationAmount: 500,
      noiseScale: 2,
      grainAmount: 0.1,
      grainScale: 2,
      grainAnimated: false,
      contrast: 1.5,
      gamma: 1,
      saturation: 1,
      centerX: 0,
      centerY: 0,
      zoom: 0.9,
    },
    controls: grainientControls,
  },
  "gradient-blinds": {
    defaults: {
      shineDirection: "left",
      angle: 20,
      noise: 0.5,
      blindCount: 16,
      blindMinWidth: 60,
      spotlightRadius: 0.5,
      distortAmount: 0,
      mouseDampening: 0.15,
    },
    controls: gradientBlindsControls,
  },
  strands: {
    defaults: {
      count: 3,
      speed: 0.5,
      amplitude: 1,
      waviness: 1,
      thickness: 0.7,
      glow: 2.6,
      taper: 3,
      spread: 1,
      hueShift: 0,
      intensity: 0.6,
      saturation: 2,
      opacity: 1,
      scale: 1.5,
      glass: false,
      refraction: 1,
      dispersion: 1,
      glassSize: 1,
    },
    controls: strandsControls,
  },
  "gradient-waves": {
    defaults: {
      speed: 0.4,
      amplitude: 2.5,
      waveScale: 0.6,
      waveRatio: 0.9,
      swell: 35,
      turbulence: 20,
      tilt: 1.11,
      zoom: 1,
      height: 5.5,
      fogDepth: 15,
      detail: "medium",
      brightness: 1,
      opacity: 1,
      mouseInteraction: true,
      parallaxStrength: 0.5,
      grain: true,
      grainIntensity: 0.05,
    },
    controls: gradientWavesControls,
  },
  beams: {
    defaults: {
      beamWidth: 3,
      beamHeight: 30,
      beamNumber: 20,
      speed: 2,
      noiseIntensity: 1.75,
      scale: 0.2,
      rotation: 30,
    },
    controls: beamsControls,
  },
  seamlessBeams: {
    defaults: {
      beamWidth: 3,
      beamHeight: 30,
      beamNumber: 20,
      speed: 2,
      noiseIntensity: 1.75,
      scale: 0.2,
      rotation: 30,
    },
    controls: beamsControls,
  },
  "line-waves": {
    defaults: {
      speed: 0.3,
      innerLineCount: 32,
      outerLineCount: 36,
      warpIntensity: 1,
      rotation: -45,
      edgeFadeWidth: 0,
      colorCycleSpeed: 1,
      brightness: 0.2,
      enableMouseInteraction: true,
      mouseInfluence: 2,
    },
    controls: lineWavesControls,
  },
  silk: {
    defaults: { speed: 5, scale: 1, noiseIntensity: 1.5, rotation: 0 },
    controls: silkControls,
  },
  "liquid-ether": {
    defaults: {
      mouseForce: 20,
      cursorSize: 100,
      resolution: 0.5,
      autoSpeed: 0.5,
      autoIntensity: 2.2,
      iterationsPoisson: 32,
      isBounce: false,
      autoDemo: true,
      isViscous: true,
      viscous: 30,
      iterationsViscous: 32,
    },
    controls: liquidEtherControls,
  },
  ferrofluid: {
    defaults: {
      mouseInteraction: true,
      flowDirection: "down",
      speed: 0.5,
      scale: 1.6,
      turbulence: 1,
      fluidity: 0.1,
      rimWidth: 0.2,
      sharpness: 2.5,
      shimmer: 1.5,
      glow: 2,
      mouseStrength: 1,
      mouseRadius: 0.35,
    },
    controls: ferrofluidControls,
  },
  ascii: {
    defaults: lightfieldDefaults(0.5),
    controls: lightfieldControls,
  },
  topo: {
    defaults: lightfieldDefaults(0.35),
    controls: lightfieldControls,
  },
  halftone: {
    defaults: lightfieldDefaults(0.4),
    controls: lightfieldControls,
  },
  ripple: {
    defaults: lightfieldDefaults(0.42),
    controls: lightfieldControls,
  },
  smoke: {
    defaults: lightfieldDefaults(0.65),
    controls: lightfieldControls,
  },
  fractal: {
    defaults: lightfieldDefaults(0.5),
    controls: lightfieldControls,
  },
  ray: {
    defaults: lightfieldDefaults(0.5),
    controls: lightfieldControls,
  },
  ink: {
    defaults: lightfieldDefaults(0.6),
    controls: lightfieldControls,
  },
  "dither-sky": {
    defaults: lightfieldDefaults(1),
    controls: lightfieldControls,
  },
  julia: {
    defaults: lightfieldDefaults(0.7),
    controls: lightfieldControls,
  },
  ...NEAT_PRESET_DEFINITIONS,
  "neat-gradient": {
    defaults: { ...lightfieldDefaults(1), ...NEAT_DEFAULTS },
    controls: [...lightfieldControls, ...NEAT_CONTROLS],
  },
  "orbs-working": { defaults: orbsDefaults(), controls: orbsControls },
  "orbs-searching": { defaults: orbsDefaults(), controls: orbsControls },
  "orbs-solving": { defaults: orbsDefaults(), controls: orbsControls },
  "orbs-listening": { defaults: orbsDefaults(), controls: orbsControls },
  "orbs-connecting": { defaults: orbsDefaults(), controls: orbsControls },
  "orbs-weaving": { defaults: orbsDefaults(), controls: orbsControls },
  "orbs-composing": { defaults: orbsDefaults(), controls: orbsControls },
  "orbs-breathing": { defaults: orbsDefaults(), controls: orbsControls },
  "orbs-shaping": { defaults: orbsDefaults(), controls: orbsControls },
};

const names: Record<BackgroundId, string> = {
  ...NEAT_PRESET_NAMES,
  "pixel-perfect-dither-wave":
    PIXEL_PERFECT_DEFINITIONS["pixel-perfect-dither-wave"].name,
  "pixel-perfect-currency-sky":
    PIXEL_PERFECT_DEFINITIONS["pixel-perfect-currency-sky"].name,
  "pixel-perfect-braille-terrain":
    PIXEL_PERFECT_DEFINITIONS["pixel-perfect-braille-terrain"].name,
  "pixel-perfect-contour-map":
    PIXEL_PERFECT_DEFINITIONS["pixel-perfect-contour-map"].name,
  "pixel-perfect-halftone-blobs":
    PIXEL_PERFECT_DEFINITIONS["pixel-perfect-halftone-blobs"].name,
  "pixel-perfect-dither-field":
    PIXEL_PERFECT_DEFINITIONS["pixel-perfect-dither-field"].name,
  "paper-mesh-gradient": "Mesh Gradient",
  "paper-static-mesh-gradient": "Static Mesh Gradient",
  "paper-static-radial-gradient": "Radial Gradient",
  "paper-dithering": "Dithering",
  "paper-grain-gradient": "Grain Gradient",
  "paper-warp": "Warp",
  "paper-dot-grid": "Dot Grid",
  "paper-simplex-noise": "Simplex Noise",
  "paper-metaballs": "Metaballs",
  none: "No background",
  "local-image": "Your image",
  "side-rays": "Side Rays",
  "soft-aurora": "Soft Aurora",
  waves: "Waves",
  "shape-blur": "Shape Blur",
  prism: "Prism",
  plasma: "Plasma",
  "pixel-blast": "Pixel Blast",
  "liquid-chrome": "Liquid Chrome",
  "light-rays": "Light Rays",
  iridescence: "Iridescence",
  grainient: "Grainient",
  "gradient-blinds": "Gradient Blinds",
  "dot-field": "Dot Field",
  dither: "Dither",
  "dark-veil": "Dark Veil",
  aurora: "Aurora",
  strands: "Strands",
  "gradient-waves": "Gradient Waves",
  beams: "Beams",
  seamlessBeams: "Seamless Beams",
  "line-waves": "Line Waves",
  silk: "Silk",
  "liquid-ether": "Liquid Ether",
  ferrofluid: "Ferrofluid",
  ascii: "ASCII",
  topo: "Topo",
  halftone: "Halftone",
  ripple: "Ripple",
  smoke: "Smoke",
  fractal: "Fractal Glass",
  ray: "Grainy Light Ray",
  ink: "Ink",
  "dither-sky": "Dither Sky",
  julia: "Julia",
  "neat-gradient": "Default (theme-aware)",
  "orbs-working": "Working",
  "orbs-searching": "Searching",
  "orbs-solving": "Solving",
  "orbs-listening": "Listening",
  "orbs-connecting": "Connecting",
  "orbs-weaving": "Weaving",
  "orbs-composing": "Composing",
  "orbs-breathing": "Breathing",
  "orbs-shaping": "Shaping",
};

const implementationIds = new Set<BackgroundId>(BACKGROUND_IMPLEMENTATION_IDS);

export const BACKGROUND_REGISTRY: readonly BackgroundDescriptor[] =
  BACKGROUND_IDS.map((id) => {
    const implementation =
      id === "none" || id === "local-image" ? undefined : implementations[id];
    return {
      id,
      name: names[id],
      available:
        id === "none" || id === "local-image" || implementationIds.has(id),
      defaults: implementation?.defaults ?? {},
      controls: implementation?.controls ?? [],
    };
  });

const descriptorMap = new Map<string, BackgroundDescriptor>(
  BACKGROUND_REGISTRY.map((descriptor) => [descriptor.id, descriptor]),
);

export function isBackgroundId(value: unknown): value is BackgroundId {
  return typeof value === "string" && descriptorMap.has(value);
}

export function getBackgroundDescriptor(
  id: BackgroundId,
): BackgroundDescriptor {
  const descriptor = descriptorMap.get(id);
  if (!descriptor) throw new Error(`Unknown background: ${id}`);
  return descriptor;
}

export function effectiveBackgroundConfig(
  id: BackgroundId,
  overrides: BackgroundOverrides,
): Record<string, BackgroundControlValue> {
  return { ...getBackgroundDescriptor(id).defaults, ...overrides[id] };
}

export function normalizeBackgroundOverrides(
  raw: unknown,
): BackgroundOverrides {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const input = raw;
  const output: BackgroundOverrides = {};

  for (const descriptor of BACKGROUND_REGISTRY) {
    const candidate: unknown = Reflect.get(input, descriptor.id);
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      continue;
    const values = candidate;
    const valid: Record<string, BackgroundControlValue> = {};

    for (const control of descriptor.controls) {
      const value: unknown = Reflect.get(values, control.key);
      if (control.type === "number") {
        if (typeof value !== "number" || !Number.isFinite(value)) continue;
        valid[control.key] = Math.min(
          control.max,
          Math.max(control.min, value),
        );
      } else if (control.type === "boolean") {
        if (typeof value === "boolean") valid[control.key] = value;
      } else if (
        typeof value === "string" &&
        control.options.some((option) => option.value === value)
      ) {
        valid[control.key] = value;
      }
    }

    if (Object.keys(valid).length > 0) output[descriptor.id] = valid;
  }

  return output;
}

export {
  PAPER_IMAGE_FILTER_IDS,
  PAPER_IMAGE_FILTERS,
  isPaperImageFilter,
  normalizeImageFilterOverrides,
  normalizeImageFilterMap,
  effectiveImageFilter,
} from "./image-filter-metadata";
export type {
  PaperImageFilterId,
  ImageFilterParams,
  ImageFilterOverrides,
  ImageFilterControl,
  ImageFilterDefinition,
} from "./image-filter-metadata";
