import type { BackgroundFactory } from "./contracts";
import { type BackgroundImplementationId } from "../../shared/background-metadata";
export type BackgroundLoader = () => Promise<{ default: BackgroundFactory }>;

export const backgroundLoaders: Record<
  BackgroundImplementationId,
  BackgroundLoader
> = {
  "neat-neat": async () => ({
    default: (await import("../neat/preset-adapter")).createNeatPreset(
      "neat-neat",
    ),
  }),
  "neat-time": async () => ({
    default: (await import("../neat/preset-adapter")).createNeatPreset(
      "neat-time",
    ),
  }),
  "neat-fluid": async () => ({
    default: (await import("../neat/preset-adapter")).createNeatPreset(
      "neat-fluid",
    ),
  }),
  "neat-flame": async () => ({
    default: (await import("../neat/preset-adapter")).createNeatPreset(
      "neat-flame",
    ),
  }),
  "neat-funky": async () => ({
    default: (await import("../neat/preset-adapter")).createNeatPreset(
      "neat-funky",
    ),
  }),
  "neat-alejandra": async () => ({
    default: (await import("../neat/preset-adapter")).createNeatPreset(
      "neat-alejandra",
    ),
  }),
  "neat-monterey": async () => ({
    default: (await import("../neat/preset-adapter")).createNeatPreset(
      "neat-monterey",
    ),
  }),
  "neat-virus": async () => ({
    default: (await import("../neat/preset-adapter")).createNeatPreset(
      "neat-virus",
    ),
  }),
  "neat-blob": async () => ({
    default: (await import("../neat/preset-adapter")).createNeatPreset(
      "neat-blob",
    ),
  }),
  "neat-sands": async () => ({
    default: (await import("../neat/preset-adapter")).createNeatPreset(
      "neat-sands",
    ),
  }),
  "neat-nighttime": async () => ({
    default: (await import("../neat/preset-adapter")).createNeatPreset(
      "neat-nighttime",
    ),
  }),
  "neat-prussian": async () => ({
    default: (await import("../neat/preset-adapter")).createNeatPreset(
      "neat-prussian",
    ),
  }),
  "neat-clouds": async () => ({
    default: (await import("../neat/preset-adapter")).createNeatPreset(
      "neat-clouds",
    ),
  }),
  "neat-lemon": async () => ({
    default: (await import("../neat/preset-adapter")).createNeatPreset(
      "neat-lemon",
    ),
  }),
  "neat-dark-mode": async () => ({
    default: (await import("../neat/preset-adapter")).createNeatPreset(
      "neat-dark-mode",
    ),
  }),
  "neat-firecms": async () => ({
    default: (await import("../neat/preset-adapter")).createNeatPreset(
      "neat-firecms",
    ),
  }),
  "neat-stripe": async () => ({
    default: (await import("../neat/preset-adapter")).createNeatPreset(
      "neat-stripe",
    ),
  }),
  "neat-pastel": async () => ({
    default: (await import("../neat/preset-adapter")).createNeatPreset(
      "neat-pastel",
    ),
  }),
  "neat-cosmic-vortex": async () => ({
    default: (await import("../neat/preset-adapter")).createNeatPreset(
      "neat-cosmic-vortex",
    ),
  }),
  "neat-bloom": async () => ({
    default: (await import("../neat/preset-adapter")).createNeatPreset(
      "neat-bloom",
    ),
  }),
  "neat-night-dunes": async () => ({
    default: (await import("../neat/preset-adapter")).createNeatPreset(
      "neat-night-dunes",
    ),
  }),
  "neat-bubble-gum": async () => ({
    default: (await import("../neat/preset-adapter")).createNeatPreset(
      "neat-bubble-gum",
    ),
  }),
  "neat-oceans-eleven": async () => ({
    default: (await import("../neat/preset-adapter")).createNeatPreset(
      "neat-oceans-eleven",
    ),
  }),
  "neat-coral": async () => ({
    default: (await import("../neat/preset-adapter")).createNeatPreset(
      "neat-coral",
    ),
  }),
  "neat-oil-slick": async () => ({
    default: (await import("../neat/preset-adapter")).createNeatPreset(
      "neat-oil-slick",
    ),
  }),
  "pixel-perfect-dither-wave": async () => ({
    default: (await import("../pixel-perfect/dither-wave")).create,
  }),
  "pixel-perfect-currency-sky": async () => ({
    default: (await import("../pixel-perfect/currency-sky")).create,
  }),
  "pixel-perfect-braille-terrain": async () => ({
    default: (await import("../pixel-perfect/braille-terrain")).create,
  }),
  "pixel-perfect-contour-map": async () => ({
    default: (await import("../pixel-perfect/contour-map")).create,
  }),
  "pixel-perfect-halftone-blobs": async () => ({
    default: (await import("../pixel-perfect/halftone-blobs")).create,
  }),
  "pixel-perfect-dither-field": async () => ({
    default: (await import("../pixel-perfect/dither-field")).create,
  }),

  "paper-mesh-gradient": async () => ({
    default: (await import("../paper/mesh-gradient")).create,
  }),
  "paper-static-mesh-gradient": async () => ({
    default: (await import("../paper/static-mesh-gradient")).create,
  }),
  "paper-static-radial-gradient": async () => ({
    default: (await import("../paper/static-radial-gradient")).create,
  }),
  "paper-dithering": async () => ({
    default: (await import("../paper/dithering")).create,
  }),
  "paper-grain-gradient": async () => ({
    default: (await import("../paper/grain-gradient")).create,
  }),
  "paper-warp": async () => ({
    default: (await import("../paper/warp")).create,
  }),
  "paper-dot-grid": async () => ({
    default: (await import("../paper/dot-grid")).create,
  }),
  "paper-simplex-noise": async () => ({
    default: (await import("../paper/simplex-noise")).create,
  }),
  "paper-metaballs": async () => ({
    default: (await import("../paper/metaballs")).create,
  }),
  "side-rays": async () => {
    const module = await import("../side-rays");
    return { default: module.createSideRays };
  },
  "soft-aurora": async () => {
    const module = await import("../soft-aurora");
    return { default: module.createSoftAurora };
  },
  waves: async () => {
    const module = await import("../waves");
    return { default: module.createWaves };
  },
  "shape-blur": async () => {
    const module = await import("../shape-blur");
    return { default: module.createShapeBlur };
  },
  prism: async () => {
    const module = await import("../prism");
    return { default: module.createPrism };
  },
  plasma: async () => {
    const module = await import("../plasma");
    return { default: module.createPlasma };
  },
  "pixel-blast": async () => {
    const module = await import("../pixel-blast");
    return { default: module.createPixelBlast };
  },
  "liquid-chrome": async () => {
    const module = await import("../liquid-chrome");
    return { default: module.createLiquidChrome };
  },
  "light-rays": async () => {
    const module = await import("../light-rays");
    return { default: module.createLightRays };
  },
  iridescence: async () => {
    const module = await import("../iridescence");
    return { default: module.createIridescence };
  },
  "dot-field": async () => {
    const module = await import("../dot-field");
    return { default: module.createDotField };
  },
  dither: async () => {
    const module = await import("../dither");
    return { default: module.createDither };
  },
  "dark-veil": async () => {
    const module = await import("../dark-veil");
    return { default: module.createDarkVeil };
  },
  aurora: async () => {
    const module = await import("../aurora");
    return { default: module.createAurora };
  },
  grainient: async () => {
    const module = await import("../grainient");
    return { default: module.createGrainient };
  },
  "gradient-blinds": async () => {
    const module = await import("../gradient-blinds");
    return { default: module.createGradientBlinds };
  },
  strands: async () => {
    const module = await import("../strands");
    return { default: module.createStrands };
  },
  "gradient-waves": async () => {
    const module = await import("../gradient-waves");
    return { default: module.createGradientWaves };
  },
  beams: async () => {
    const module = await import("../beams");
    return { default: module.createBeams };
  },
  seamlessBeams: async () => {
    const module = await import("../beams");
    return { default: module.createSeamlessBeams };
  },
  "line-waves": async () => {
    const module = await import("../line-waves");
    return { default: module.createLineWaves };
  },
  silk: async () => {
    const module = await import("../silk");
    return { default: module.createSilk };
  },
  "liquid-ether": async () => {
    const module = await import("../liquid-ether");
    return { default: module.createLiquidEther };
  },
  ferrofluid: async () => {
    const module = await import("../ferrofluid");
    return { default: module.createFerrofluid };
  },
  ascii: async () => {
    const module = await import("../ascii");
    return { default: module.createAscii };
  },
  topo: async () => {
    const module = await import("../topo");
    return { default: module.createTopo };
  },
  halftone: async () => {
    const module = await import("../halftone");
    return { default: module.createHalftone };
  },
  ripple: async () => {
    const module = await import("../ripple");
    return { default: module.createRipple };
  },
  smoke: async () => {
    const module = await import("../smoke");
    return { default: module.createSmoke };
  },
  fractal: async () => {
    const module = await import("../fractal");
    return { default: module.createFractal };
  },
  ray: async () => {
    const module = await import("../ray");
    return { default: module.createRay };
  },
  ink: async () => {
    const module = await import("../ink");
    return { default: module.createInk };
  },
  "dither-sky": async () => {
    const module = await import("../dither-sky");
    return { default: module.createDitherSky };
  },
  julia: async () => {
    const module = await import("../julia");
    return { default: module.createJulia };
  },
  "neat-gradient": async () => {
    const module = await import("../neat");
    return { default: module.createNeat };
  },
  "orbs-working": async () => {
    const module = await import("../orbs/index");
    return { default: module.createOrbsState("working") };
  },
  "orbs-searching": async () => {
    const module = await import("../orbs/index");
    return { default: module.createOrbsState("searching") };
  },
  "orbs-solving": async () => {
    const module = await import("../orbs/index");
    return { default: module.createOrbsState("solving") };
  },
  "orbs-listening": async () => {
    const module = await import("../orbs/index");
    return { default: module.createOrbsState("listening") };
  },
  "orbs-connecting": async () => {
    const module = await import("../orbs/index");
    return { default: module.createOrbsState("connecting") };
  },
  "orbs-weaving": async () => {
    const module = await import("../orbs/index");
    return { default: module.createOrbsState("weaving") };
  },
  "orbs-composing": async () => {
    const module = await import("../orbs/index");
    return { default: module.createOrbsState("composing") };
  },
  "orbs-breathing": async () => {
    const module = await import("../orbs/index");
    return { default: module.createOrbsState("breathing") };
  },
  "orbs-shaping": async () => {
    const module = await import("../orbs/index");
    return { default: module.createOrbsState("shaping") };
  },
};

export const BACKGROUND_LOADER_IDS: readonly BackgroundImplementationId[] =
  Object.keys(backgroundLoaders) as BackgroundImplementationId[];

export const localImageLoader = () => import("../local-image");
