import { requiredValue } from "../../src/effects/runtime/required-value";
import { test } from "bun:test";
import {
  BACKGROUND_IDS,
  BACKGROUND_REGISTRY,
  BACKGROUND_COLLECTIONS,
  LIGHTFIELD_COLLECTION,
  ORBS_COLLECTION,
  REACT_BITS_COLLECTION,
  effectiveBackgroundConfig,
} from "../../src/shared/background-metadata";
import { ditherElapsedTime } from "../../src/effects/dither-timing";
import {
  ORBS_COUNT_CAP,
  ORBS_REDUCED_MOTION_TIME,
  SOURCE_VISUAL_REFERENCE_SIZE,
  createOrbsFrame,
  createOrbsViewportProfile,
  normalizeOrbsConfig,
  orbsPaletteColor,
} from "../../src/effects/orbs/index";
import {
  MODE_FRAMES,
  STATE_TO_MODE,
  resolvePreset,
} from "../../src/vendor/orbs/engine.js";
import {
  dotBulgeOffset,
  stepDotPointerSpeed,
  stepWavesPointer,
} from "../../src/effects/canvas-math";
import { dotRepulsionImpulse } from "../../src/effects/dot-field";
import { lightRaysAnchor } from "../../src/effects/light-rays";

import {
  plasmaPingPongTime,
  shouldContinueOglAnimation,
  shouldResizeOglBacking,
} from "../../src/effects/ogl-math";
import {
  PRISM_INITIAL_EULER,
  PRISM_INITIAL_POINTER,
  PRISM_INITIAL_ROTATION,
  shouldResetPrismAnimationState,
} from "../../src/effects/prism";
import {
  PLASMA_INITIAL_POINTER,
  shouldResetPlasmaPointer,
} from "../../src/effects/plasma";
import { LIQUID_CHROME_INITIAL_POINTER } from "../../src/effects/liquid-chrome";
import { IRIDESCENCE_INITIAL_POINTER } from "../../src/effects/iridescence";
import { shouldAnimateGrainient } from "../../src/effects/grainient";
import {
  effectiveBlindCount,
  gradientBlindsAngleRadians,
  gradientBlindsDampingFactor,
  gradientBlindsDependenciesChanged,
  gradientBlindsDependencyValues,
  gradientBlindsRecreationTransition,
} from "../../src/effects/gradient-blinds";
import { strandsGlassRadius } from "../../src/effects/strands";
import {
  gradientWavesDetailSteps,
  shouldAnimateGradientWaves,
} from "../../src/effects/gradient-waves";
import {
  LINE_WAVES_INITIAL_MOUSE,
  lineWavesDependencySnapshot,
  lineWavesPointerCoordinates,
  lineWavesRotationRadians,
  stepLineWavesMouse,
} from "../../src/effects/line-waves";
import {
  BEAMS_HEIGHT_SEGMENTS,
  BEAMS_SPACING,
  createBeamsMaterial,
  createStackedPlanesBufferGeometry,
} from "../../src/effects/beams";
import {
  silkDependencySnapshot,
  silkTimeAdvance,
  silkViewportSize,
} from "../../src/effects/silk";
import {
  LIQUID_ETHER_AUTO_RAMP_DURATION,
  LIQUID_ETHER_AUTO_RESUME_DELAY,
  LIQUID_ETHER_BFECC,
  LIQUID_ETHER_DT,
  LIQUID_ETHER_TAKEOVER_DURATION,
  liquidEtherTargetFits,
  liquidEtherTargetSize,
  makeLiquidEtherPaletteTexture,
} from "../../src/effects/liquid-ether";
import {
  FERROFLUID_INITIAL_MOUSE,
  ferrofluidDampingFactor,
  ferrofluidDependencySnapshot,
  ferrofluidFlowVector,
  ferrofluidPointerCoordinates,
  prepareFerrofluidColors,
  shouldAnimateFerrofluid,
} from "../../src/effects/ferrofluid";
import type {
  BackgroundContext,
  ThemePalette,
} from "../../src/effects/runtime/contracts";
import { ORBS_DEFAULT_SCALE_PCT } from "../../src/shared/orbs-metadata";

// Relevant engine/math portions of source backgrounds/self-check.ts; native schema checks remain native-owned.
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), message);
}

test("source runtime integrity: Orbs geometry/caps, Three geometry/materials, palettes and engine clocks", () => {
  // ---- Orbs (standalone collection, one card per state) ---------------------
  const ORBS_STATE_IDS = [
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
  assertEqual(
    [
      ORBS_DEFAULT_SCALE_PCT,
      SOURCE_VISUAL_REFERENCE_SIZE,
      ORBS_COUNT_CAP,
      ORBS_REDUCED_MOTION_TIME,
    ],
    [47.4, 1024, 12_000, 0.6],
    "Orbs adapter constants drifted",
  );
  const defaultReferenceProfile = createOrbsViewportProfile(
    "searching",
    1920,
    1080,
    {},
  );
  assert(
    Math.abs(
      defaultReferenceProfile.logicalSide / SOURCE_VISUAL_REFERENCE_SIZE - 1,
    ) < 0.001,
    "Orbs default Scale stopped matching the normalized 1024px source composition at 1920×1080",
  );
  assertEqual(
    ORBS_COLLECTION.ids,
    [...ORBS_STATE_IDS],
    "Orbs standalone collection membership or order drifted",
  );
  assert(
    ORBS_COLLECTION.name === "Orbs",
    "Orbs collection display name drifted",
  );
  assert(
    ORBS_COLLECTION.attribution ===
      "Uses Thinking Orbs engine by Jakub Antalík (MIT), with theme/lifecycle adapter.",
    "Orbs collection attribution drifted",
  );
  assert(
    ORBS_COLLECTION.link?.href === "https://github.com/Jakubantalik/Libraries",
    "Orbs collection lost its canonical source link",
  );
  assert(
    BACKGROUND_COLLECTIONS.length === 7,
    "collection count drifted; Personal, Neat, Paper, Pixel Perfect and Orbs must remain standalone",
  );
  assertEqual(
    BACKGROUND_COLLECTIONS.map((collection) => collection.id),
    [
      "personal",
      "react-bits",
      "orbs",
      "meridian",
      "neat",
      "paper",
      "pixel-perfect",
    ],
    "collection registry order drifted",
  );
  assertEqual(
    BACKGROUND_COLLECTIONS.filter((collection) =>
      collection.ids.includes("neat-gradient"),
    ).map((collection) => collection.id),
    ["neat"],
    "Neat collection ownership drifted",
  );
  assertEqual(
    requiredValue(BACKGROUND_COLLECTIONS[0]).ids,
    ["none", "local-image"],
    "Personal source membership drifted",
  );
  const collectedBackgroundIds = BACKGROUND_COLLECTIONS.flatMap(
    (collection) => collection.ids,
  );
  assert(
    collectedBackgroundIds.length === 86 &&
      new Set(collectedBackgroundIds).size === 86 &&
      BACKGROUND_IDS.every((id) => collectedBackgroundIds.includes(id)),
    "Every background must belong to exactly one collection",
  );
  for (const id of ORBS_STATE_IDS) {
    assert(
      !LIGHTFIELD_COLLECTION.ids.includes(id),
      `${id} leaked into the Meridian collection`,
    );
    assert(
      !REACT_BITS_COLLECTION.ids.includes(id),
      `${id} leaked into the React Bits collection`,
    );
  }
  const orbsStates = ORBS_STATE_IDS.map((id) =>
    id.slice("orbs-".length),
  ) as (keyof typeof STATE_TO_MODE)[];
  assertEqual(
    Object.keys(STATE_TO_MODE),
    orbsStates,
    "copied engine state-to-mode order or completeness drifted",
  );
  assertEqual(
    Object.values(STATE_TO_MODE).sort(),
    Object.keys(MODE_FRAMES).sort(),
    "copied engine mode frame generators are incomplete",
  );
  for (const state of orbsStates) {
    const preset = resolvePreset(state, SOURCE_VISUAL_REFERENCE_SIZE);
    const first = MODE_FRAMES[preset.mode](SOURCE_VISUAL_REFERENCE_SIZE, 0.6, {
      ...preset.opts,
    });
    const second = MODE_FRAMES[preset.mode](SOURCE_VISUAL_REFERENCE_SIZE, 0.6, {
      ...preset.opts,
    });
    assertEqual(
      first,
      second,
      `copied engine ${state} frame stopped being deterministic`,
    );
    const defaultReferenceFrame = createOrbsFrame(state, 1920, 1080, {}, 0.6);
    assert(
      defaultReferenceFrame.dots.length + defaultReferenceFrame.lines.length ===
        first.dots.length + first.lines.length,
      `Orbs ${state} source-equivalent default count drifted at 1920×1080`,
    );
    assert(first.dots.length > 0, `copied engine ${state} frame has no dots`);
    assert(
      first.dots.every(
        (dot) =>
          Number.isFinite(dot.x) &&
          Number.isFinite(dot.y) &&
          Number.isFinite(dot.z) &&
          dot.r > 0,
      ),
      `copied engine ${state} frame shape is invalid`,
    );
    const capped4kFrame = createOrbsFrame(
      state,
      3840,
      2160,
      { scale: 60 },
      0.6,
    );
    assert(
      capped4kFrame.dots.length + capped4kFrame.lines.length <= ORBS_COUNT_CAP,
      `Orbs ${state} exceeded the 4K count cap`,
    );
  }
  for (const state of ["working", "connecting"] as const) {
    for (const time of [0, 0.6, 2, 10, 43.4]) {
      const frame = createOrbsFrame(state, 3840, 2160, { scale: 60 }, time);
      assert(
        frame.dots.length + frame.lines.length <= ORBS_COUNT_CAP,
        `Orbs ${state} exceeded the actual count cap at cycle time ${String(time)}`,
      );
    }
  }
  const median = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    return requiredValue(sorted[Math.floor(sorted.length / 2)]);
  };
  const smallOrbsFrame = createOrbsFrame(
    "searching",
    320,
    320,
    { scale: 10, density: 100 },
    0.6,
  );
  const largeOrbsFrame = createOrbsFrame(
    "searching",
    1280,
    1280,
    { scale: 30, density: 100 },
    0.6,
  );
  assert(
    Math.max(
      median(smallOrbsFrame.dots.map((dot) => dot.r)),
      median(largeOrbsFrame.dots.map((dot) => dot.r)),
    ) /
      Math.min(
        median(smallOrbsFrame.dots.map((dot) => dot.r)),
        median(largeOrbsFrame.dots.map((dot) => dot.r)),
      ) <
      1.3,
    "Orbs dot-radius distribution grew with viewport/scale",
  );
  assert(
    largeOrbsFrame.dots.length > smallOrbsFrame.dots.length,
    "Orbs scale stopped growing sample count with area",
  );
  assert(
    largeOrbsFrame.dots.length + largeOrbsFrame.lines.length <= ORBS_COUNT_CAP,
    "Orbs density cap exceeded its hard limit",
  );
  const densityFrames = [25, 100, 200].map((density) =>
    createOrbsFrame("searching", 1067, 861, { scale: 30, density }, 0.6),
  );
  const densityCounts = densityFrames.map(
    (frame) => frame.dots.length + frame.lines.length,
  );
  assert(
    requiredValue(densityCounts[0]) < requiredValue(densityCounts[1]) &&
      requiredValue(densityCounts[1]) < requiredValue(densityCounts[2]),
    "Orbs Density stopped changing count monotonically",
  );
  assert(
    requiredValue(densityCounts[2]) / requiredValue(densityCounts[0]) > 6 &&
      requiredValue(densityCounts[2]) / requiredValue(densityCounts[0]) < 10,
    "Orbs Density 25–200 count span drifted too far from 8x",
  );
  assert(
    densityFrames.every(
      (frame) =>
        frame.logicalSide === requiredValue(densityFrames[0]).logicalSide,
    ),
    "Orbs Density changed overall Scale",
  );
  assert(
    Math.abs(
      requiredValue(densityFrames[2]).countScale /
        requiredValue(densityFrames[0]).countScale -
        8,
    ) < 1e-12,
    "Orbs Density stopped scaling desired count by 8x",
  );
  const densityMedianRadii = densityFrames.map((frame) =>
    median(frame.dots.map((dot) => dot.r)),
  );
  assert(
    Math.max(...densityMedianRadii) / Math.min(...densityMedianRadii) < 1.08,
    "Orbs Density changed median dot radius",
  );
  const scaleFrames = [20, 40].map((scale) =>
    createOrbsFrame("searching", 1280, 1024, { scale, density: 100 }, 0.6),
  );
  const scaleCounts = scaleFrames.map(
    (frame) => frame.dots.length + frame.lines.length,
  );
  assert(
    requiredValue(scaleCounts[1]) / requiredValue(scaleCounts[0]) > 3.2 &&
      requiredValue(scaleCounts[1]) / requiredValue(scaleCounts[0]) < 4.8,
    "Orbs Scale 20–40 count stopped following visible area",
  );
  assert(
    Math.abs(
      requiredValue(scaleFrames[1]).countScale /
        requiredValue(scaleFrames[0]).countScale -
        4,
    ) < 1e-12,
    "Orbs Scale stopped scaling desired count by visible area",
  );
  const scaleMedianRadii = scaleFrames.map((frame) =>
    median(frame.dots.map((dot) => dot.r)),
  );
  assert(
    Math.max(...scaleMedianRadii) / Math.min(...scaleMedianRadii) < 1.08,
    "Orbs Scale changed median dot radius",
  );
  const sourceSearchingPreset = resolvePreset(
    "searching",
    SOURCE_VISUAL_REFERENCE_SIZE,
  );
  const sourceSearchingFrame = MODE_FRAMES[sourceSearchingPreset.mode](
    SOURCE_VISUAL_REFERENCE_SIZE,
    0.6,
    { ...sourceSearchingPreset.opts },
  );
  const anchoredSearchingFrame = createOrbsFrame(
    "searching",
    1024,
    1024,
    { scale: 50, density: 100 },
    0.6,
  );
  assertEqual(
    anchoredSearchingFrame.dots,
    sourceSearchingFrame.dots,
    "Orbs 1024px radius/geometry anchor drifted from the source demo",
  );
  const sourceConnectingFrame = createOrbsFrame(
    "connecting",
    1024,
    1024,
    { scale: 50, density: 100 },
    0.6,
  );
  const extensionConnectingFrame = createOrbsFrame(
    "connecting",
    1067,
    861,
    { scale: 30, density: 100 },
    0.6,
  );
  assert(
    Math.abs(
      median(sourceConnectingFrame.lines.map((line) => line.w)) -
        median(extensionConnectingFrame.lines.map((line) => line.w)),
    ) < 1e-12,
    "Orbs line width grew with viewport/Scale",
  );
  const originalGlobeFrame = MODE_FRAMES.globe;
  const allocatedDot = { x: 1, y: 2, z: 0, r: 3, white: 0.5 };
  const allocatedLine = { x1: 1, y1: 2, x2: 3, y2: 4, white: 0.5, w: 2 };
  (MODE_FRAMES as unknown as Record<string, typeof originalGlobeFrame>).globe =
    () => ({
      dots: [allocatedDot],
      lines: [allocatedLine],
    });
  let adaptedFrame: ReturnType<typeof createOrbsFrame>;
  try {
    adaptedFrame = createOrbsFrame("searching", 100, 80, { scale: 30 }, 0.6);
  } finally {
    (
      MODE_FRAMES as unknown as Record<string, typeof originalGlobeFrame>
    ).globe = originalGlobeFrame;
  }
  assert(
    adaptedFrame.dots[0] === allocatedDot &&
      adaptedFrame.lines[0] === allocatedLine,
    "Orbs adapter stopped mutating newly allocated engine objects in place",
  );
  assert(
    allocatedDot.x !== 1 && allocatedLine.x1 !== 1,
    "Orbs in-place geometry adaptation did not run",
  );
  let cappedGenerationAttempts = 0;
  (MODE_FRAMES as unknown as Record<string, typeof originalGlobeFrame>).globe =
    (_size, _time, options) => {
      cappedGenerationAttempts++;
      const count = Math.ceil(
        (options.latRings ?? 2) * (options.lonDensity ?? 2),
      );
      return {
        dots: Array.from({ length: count }, (_, index) => ({
          x: index,
          y: 0,
          z: 0,
          r: 1,
          white: 0.5,
        })),
        lines: [],
      };
    };
  let forcedCappedFrame: ReturnType<typeof createOrbsFrame>;
  try {
    forcedCappedFrame = createOrbsFrame(
      "searching",
      15360,
      8640,
      { scale: 60, density: 200 },
      2,
    );
  } finally {
    (
      MODE_FRAMES as unknown as Record<string, typeof originalGlobeFrame>
    ).globe = originalGlobeFrame;
  }
  assert(
    cappedGenerationAttempts > 1,
    "Orbs hard cap stopped regenerating oversized actual frames",
  );
  assert(
    forcedCappedFrame.dots.length + forcedCappedFrame.lines.length <=
      ORBS_COUNT_CAP,
    "Orbs regenerated frame still exceeded its hard cap",
  );
  assertEqual(
    normalizeOrbsConfig({
      opacity: 9,
      speed: 0.1,
      scale: 99,
      density: 999,
      x: -99,
      y: 99,
    }),
    { opacity: 1, speed: 0.25, scale: 60, density: 200, x: -50, y: 50 },
    "Orbs adapter clamps drifted",
  );
  const orbsTestPalette = {
    paper: [0.1, 0.2, 0.3] as [number, number, number],
    paperHex: "#123456",
    ink: [0.9, 0.8, 0.7] as [number, number, number],
    inkHex: "#fedcba",
    accent: [1, 0, 0] as [number, number, number],
    accentHex: "#ff0000",
    focus: [0, 1, 0] as [number, number, number],
    focusHex: "#00ff00",
    lightTheme: false,
  };
  const lightEndpointPalette = { ...orbsTestPalette, lightTheme: true };
  const orbsMuted = [0.5, 0.5, 0.5];
  assertEqual(
    orbsPaletteColor(lightEndpointPalette, 0),
    lightEndpointPalette.ink,
    "Orbs light theme ink endpoint drifted",
  );
  assertEqual(
    orbsPaletteColor(lightEndpointPalette, 0.5),
    orbsMuted,
    "Orbs light theme muted midpoint drifted",
  );
  assertEqual(
    orbsPaletteColor(lightEndpointPalette, 1),
    lightEndpointPalette.paper,
    "Orbs light theme paper endpoint drifted",
  );
  assertEqual(
    orbsPaletteColor(orbsTestPalette, 0),
    orbsTestPalette.ink,
    "Orbs dark theme ink endpoint drifted",
  );
  assertEqual(
    orbsPaletteColor(orbsTestPalette, 0.5),
    orbsMuted,
    "Orbs dark theme muted midpoint drifted",
  );
  assertEqual(
    orbsPaletteColor(orbsTestPalette, 1),
    orbsTestPalette.paper,
    "Orbs dark theme paper endpoint drifted",
  );

  const beamsMaterialContext = {
    config: effectiveBackgroundConfig("beams", {}),
    palette: { paperHex: "#112233", inkHex: "#aabbcc" },
  } as unknown as BackgroundContext;
  const beamsMaterial = createBeamsMaterial(beamsMaterialContext);
  assert(
    beamsMaterial.lights && beamsMaterial.fog,
    "Beams physical material lost lights or fog",
  );
  assert(
    requiredValue(beamsMaterial.uniforms.roughness).value === 0.3 &&
      requiredValue(beamsMaterial.uniforms.metalness).value === 0.3 &&
      requiredValue(beamsMaterial.uniforms.envMapIntensity).value === 10,
    "Beams physical material constants drifted",
  );
  assert(
    (
      requiredValue(beamsMaterial.uniforms.diffuse).value as {
        getHexString(): string;
      }
    ).getHexString() === "112233",
    "Beams material diffuse stopped mapping paper",
  );

  beamsMaterial.dispose();
  const originalRandom = Math.random;
  let beamsGeometry: ReturnType<typeof createStackedPlanesBufferGeometry>;
  let seamlessBeamsGeometry: ReturnType<
    typeof createStackedPlanesBufferGeometry
  >;
  try {
    // BufferGeometry's UUID consumes four random samples before geometry phase samples.
    const randomOffsets = [0.1, 0.1, 0.1, 0.1, 0.25, 0.5, 0.75, 0.125];
    Math.random = () => requiredValue(randomOffsets.shift());
    beamsGeometry = createStackedPlanesBufferGeometry(2, 3, 30);
    const sharedRandomOffsets = [0.1, 0.1, 0.1, 0.1, 0.25, 0.5, 0.75];
    Math.random = () => requiredValue(sharedRandomOffsets.shift());
    seamlessBeamsGeometry = createStackedPlanesBufferGeometry(
      2,
      3,
      30,
      BEAMS_SPACING,
      BEAMS_HEIGHT_SEGMENTS,
      "shared",
    );
  } finally {
    Math.random = originalRandom;
  }
  const beamsPositions = beamsGeometry.getAttribute("position");
  const beamsUvs = beamsGeometry.getAttribute("uv");
  assert(
    beamsPositions.count === 404 &&
      beamsUvs.count === 404 &&
      beamsGeometry.index?.count === 1200,
    "Beams stacked-plane buffer topology drifted",
  );
  assertEqual(
    Array.from(beamsPositions.array.slice(0, 6)),
    [-3, -15, 0, 0, -15, 0],
    "Beams plane placement drifted",
  );
  assertEqual(
    Array.from(beamsUvs.array.slice(0, 4)),
    [75, 150, 76, 150],
    "Beams first random UV offset drifted",
  );
  assertEqual(
    Array.from(beamsUvs.array.slice(404, 408)),
    [225, 37.5, 226, 37.5],
    "Beams per-plane random UV offsets drifted",
  );
  const seamlessPositions = seamlessBeamsGeometry.getAttribute("position");
  const seamlessUvs = seamlessBeamsGeometry.getAttribute("uv");
  assert(
    seamlessPositions.count === beamsPositions.count &&
      seamlessBeamsGeometry.index?.count ===
        requiredValue(beamsGeometry.index).count,
    "Seamless Beams changed Beams topology or performance cost",
  );
  assertEqual(
    Array.from(seamlessUvs.array.slice(0, 4)),
    [150, 75, 151, 75],
    "Seamless Beams first UV offsets drifted",
  );
  assertEqual(
    Array.from(seamlessUvs.array.slice(404, 408)),
    [225, 75, 226, 75],
    "Seamless Beams stopped sharing only its displacement phase",
  );
  assert(
    seamlessUvs.getX(0) !== seamlessUvs.getX((BEAMS_HEIGHT_SEGMENTS + 1) * 2) &&
      seamlessUvs.getY(0) === seamlessUvs.getY((BEAMS_HEIGHT_SEGMENTS + 1) * 2),
    "Seamless Beams stopped preserving distinct X offsets with a shared Y phase",
  );
  for (let row = 0; row <= BEAMS_HEIGHT_SEGMENTS; row++) {
    const leftBoundaryVertex = row * 2 + 1;
    const rightBoundaryVertex = (BEAMS_HEIGHT_SEGMENTS + 1) * 2 + row * 2;
    assert(
      seamlessPositions.getX(leftBoundaryVertex) ===
        seamlessPositions.getX(rightBoundaryVertex) &&
        seamlessPositions.getY(leftBoundaryVertex) ===
          seamlessPositions.getY(rightBoundaryVertex) &&
        seamlessUvs.getY(leftBoundaryVertex) ===
          seamlessUvs.getY(rightBoundaryVertex),
      `Seamless Beams boundary ${String(row)} lost position/phase continuity`,
    );
  }
  assert(
    beamsGeometry.groups.length === 0 &&
      seamlessBeamsGeometry.groups.length === 0,
    "Open Beams variants gained material groups",
  );
  beamsGeometry.dispose();
  seamlessBeamsGeometry.dispose();

  assert(
    Math.abs(lineWavesRotationRadians(-45) + Math.PI / 4) < 1e-12,
    "Line Waves degree rotation drifted",
  );
  assertEqual(
    LINE_WAVES_INITIAL_MOUSE,
    [0.5, 0.5],
    "Line Waves initial/leave mouse state drifted",
  );
  assertEqual(
    stepLineWavesMouse([0.5, 0.5], [1, 0]),
    [0.525, 0.475],
    "Line Waves 0.05 mouse easing drifted",
  );
  assertEqual(
    lineWavesPointerCoordinates(60, 45, {
      left: 10,
      top: 20,
      width: 100,
      height: 50,
    }),
    [0.5, 0.5],
    "Line Waves pinned pointer normalization drifted",
  );
  assert(
    lineWavesPointerCoordinates(9, 45, {
      left: 10,
      top: 20,
      width: 100,
      height: 50,
    }) === null,
    "Line Waves accepted an out-of-bounds pointer",
  );
  const lineSnapshot = lineWavesDependencySnapshot(
    {
      speed: 1,
      innerLineCount: 2,
      outerLineCount: 3,
      warpIntensity: 4,
      rotation: 5,
      edgeFadeWidth: 0.1,
      colorCycleSpeed: 1,
      brightness: 1,
      enableMouseInteraction: true,
      mouseInfluence: 2,
    },
    [0.1, 0.2, 0.3],
  );
  assert(
    lineSnapshot ===
      lineWavesDependencySnapshot(
        {
          speed: 1,
          innerLineCount: 2,
          outerLineCount: 3,
          warpIntensity: 4,
          rotation: 5,
          edgeFadeWidth: 0.1,
          colorCycleSpeed: 1,
          brightness: 1,
          enableMouseInteraction: true,
          mouseInfluence: 2,
        },
        [0.1, 0.2, 0.3],
      ),
    "same-value Line Waves update changed dependency snapshot",
  );
  assert(
    lineSnapshot !==
      lineWavesDependencySnapshot(
        {
          speed: 2,
          innerLineCount: 2,
          outerLineCount: 3,
          warpIntensity: 4,
          rotation: 5,
          edgeFadeWidth: 0.1,
          colorCycleSpeed: 1,
          brightness: 1,
          enableMouseInteraction: true,
          mouseInfluence: 2,
        },
        [0.1, 0.2, 0.3],
      ),
    "Line Waves control change did not invalidate remount state",
  );
  assert(silkTimeAdvance(2, 0.5) === 2.05, "Silk 0.1 delta time rate drifted");
  const silkViewport = silkViewportSize(75, 5, 16 / 9);
  assert(
    Math.abs(silkViewport[0] / silkViewport[1] - 16 / 9) < 1e-12 &&
      silkViewport[1] > 0,
    "Silk default-camera viewport coverage drifted",
  );

  const silkSnapshot = silkDependencySnapshot(
    { speed: 5, scale: 1, noiseIntensity: 1.5, rotation: 0 },
    [0.1, 0.2, 0.3],
  );
  assert(
    silkSnapshot ===
      silkDependencySnapshot(
        { speed: 5, scale: 1, noiseIntensity: 1.5, rotation: 0 },
        [0.1, 0.2, 0.3],
      ),
    "same-value Silk update changed dependency snapshot",
  );
  assert(
    silkSnapshot !==
      silkDependencySnapshot(
        { speed: 5, scale: 1, noiseIntensity: 1.5, rotation: 0 },
        [0.1, 0.2, 0.4],
      ),
    "Silk palette change did not invalidate remount state",
  );

  assertEqual(
    liquidEtherTargetSize(1280, 720, 0.5),
    [640, 360],
    "Liquid Ether targets stopped using CSS host size and resolution",
  );
  assertEqual(
    liquidEtherTargetSize(0, 0, 0.5),
    [1, 1],
    "Liquid Ether zero-size target tolerance drifted",
  );
  assert(
    liquidEtherTargetFits(4096, 2048, 4096) &&
      !liquidEtherTargetFits(4097, 2048, 4096),
    "Liquid Ether MAX_TEXTURE_SIZE preflight drifted",
  );
  assert(
    effectiveBackgroundConfig("liquid-ether", {}).isViscous === true,
    "Liquid Ether live viscosity default was disabled",
  );
  assertEqual(
    [
      LIQUID_ETHER_DT,
      LIQUID_ETHER_BFECC,
      LIQUID_ETHER_TAKEOVER_DURATION,
      LIQUID_ETHER_AUTO_RESUME_DELAY,
      LIQUID_ETHER_AUTO_RAMP_DURATION,
    ],
    [0.014, true, 0.25, 500, 0.6],
    "Liquid Ether fixed live values drifted",
  );
  const liquidTexture = makeLiquidEtherPaletteTexture({
    accentHex: "#ff0000",
    focusHex: "#00ff00",
    inkHex: "#0000ff",
  });
  assertEqual(
    Array.from(liquidTexture.image.data as Uint8Array),
    [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255],
    "Liquid Ether [accent, focus, ink] DataTexture mapping drifted",
  );
  assert(
    liquidTexture.image.width === 3 &&
      liquidTexture.image.height === 1 &&
      liquidTexture.magFilter === 1006 &&
      liquidTexture.minFilter === 1006,
    "Liquid Ether palette texture dimensions/filtering drifted",
  );
  liquidTexture.dispose();

  assertEqual(
    [
      ferrofluidFlowVector("down"),
      ferrofluidFlowVector("up"),
      ferrofluidFlowVector("left"),
      ferrofluidFlowVector("right"),
      ferrofluidFlowVector("bad"),
    ],
    [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
      [0, -1],
    ],
    "Ferrofluid flow vectors drifted",
  );
  const preparedFerrofluid = prepareFerrofluidColors([
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]);
  assert(
    preparedFerrofluid.count === 3 && preparedFerrofluid.colors.length === 8,
    "Ferrofluid eight-color preparation count drifted",
  );
  assertEqual(
    preparedFerrofluid.colors.slice(2),
    Array.from({ length: 6 }, () => [0, 0, 1]),
    "Ferrofluid trailing color repetition drifted",
  );
  assertEqual(
    preparedFerrofluid.average,
    [1 / 3, 1 / 3, 1 / 3],
    "Ferrofluid color average drifted",
  );
  assertEqual(
    FERROFLUID_INITIAL_MOUSE,
    [0, 0],
    "Ferrofluid initial target/uniform state drifted",
  );
  assertEqual(
    ferrofluidPointerCoordinates(
      60,
      45,
      { left: 10, top: 20, width: 100, height: 50 },
      2,
    ),
    [100, 50],
    "Ferrofluid drawing-buffer pointer mapping drifted",
  );
  assert(
    ferrofluidPointerCoordinates(
      111,
      45,
      { left: 10, top: 20, width: 100, height: 50 },
      2,
    ) === null,
    "Ferrofluid accepted an out-of-bounds pointer",
  );
  assert(
    Math.abs(ferrofluidDampingFactor(0.15) - (1 - Math.exp(-1))) < 1e-12,
    "Ferrofluid 0.15 pointer dampening drifted",
  );
  assert(
    !shouldAnimateFerrofluid(0, false, true, [1, 1], [1, 1]) &&
      shouldAnimateFerrofluid(0, false, true, [1, 1], [2, 2]) &&
      shouldAnimateFerrofluid(0.5, false, false, [0, 0], [0, 0]),
    "Ferrofluid speed-zero settling scheduler drifted",
  );
  const ferrofluidSnapshot = ferrofluidDependencySnapshot(
    {
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
    [0.1, 0.2, 0.3],
  );
  assert(
    ferrofluidSnapshot ===
      ferrofluidDependencySnapshot(
        {
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
        [0.1, 0.2, 0.3],
      ),
    "same-value Ferrofluid update changed dependency snapshot",
  );
  assert(
    ferrofluidSnapshot !==
      ferrofluidDependencySnapshot(
        {
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
        [0.1, 0.2, 0.4],
      ),
    "Ferrofluid palette change did not invalidate remount state",
  );

  const wavePointer = stepWavesPointer({
    x: 20,
    y: 10,
    lx: 0,
    ly: 0,
    sx: 0,
    sy: 0,
    vs: 0,
    angle: 0,
  });
  assertEqual(
    [wavePointer.sx, wavePointer.sy],
    [2, 1],
    "Waves pointer smoothing drifted",
  );
  assert(
    wavePointer.vs === Math.hypot(20, 10) * 0.1,
    "Waves pointer velocity smoothing drifted",
  );
  assert(
    stepDotPointerSpeed(0, 3, 4, 0, 0) === 2.5,
    "Dot Field pointer speed smoothing drifted",
  );
  assertEqual(
    dotRepulsionImpulse(0, 0, 10, 1),
    [0, 0],
    "Dot Field exact-overlap impulse became non-finite",
  );
  assert(
    dotRepulsionImpulse(3, 4, 10, 1).every(Number.isFinite),
    "Dot Field impulse became non-finite",
  );
  const bulge = dotBulgeOffset(0, 0, 0, 0, 50, 0, 100, 40, 1);
  assertEqual(bulge, [-1.5, 0], "Dot Field bulge displacement drifted");
  assertEqual(
    lightRaysAnchor("right", 100, 50),
    { anchor: [120, 25], dir: [-1, 0] },
    "Light Rays right origin drifted",
  );
  assertEqual(
    lightRaysAnchor("bottom-center", 100, 50),
    { anchor: [50, 60], dir: [0, -1] },
    "Light Rays bottom origin drifted",
  );

  const darkVeilDescriptor = requiredValue(
    BACKGROUND_REGISTRY.find((item) => item.id === "dark-veil"),
  );
  const scanlineFrequency = requiredValue(
    darkVeilDescriptor.controls.find(
      (control) => control.key === "scanlineFrequency",
    ),
  );
  assert(
    darkVeilDescriptor.defaults.scanlineFrequency === 0,
    "Dark Veil live off-range default drifted",
  );
  assert(
    scanlineFrequency.type === "number" && scanlineFrequency.min === 0.5,
    "Dark Veil official slider minimum drifted",
  );
  assert(
    plasmaPingPongTime(0) === 0 &&
      plasmaPingPongTime(10) === 10 &&
      plasmaPingPongTime(20) === 0,
    "Plasma ping-pong endpoints drifted",
  );
  assertEqual(
    PLASMA_INITIAL_POINTER,
    [0, 0],
    "Plasma pointer reset constant drifted",
  );
  assert(
    shouldResetPlasmaPointer(true, false),
    "Plasma interaction disable transition stopped resetting pointer state",
  );
  assert(
    !shouldResetPlasmaPointer(false, true) &&
      !shouldResetPlasmaPointer(false, false),
    "Plasma pointer reset leaked outside the disable transition",
  );

  assertEqual(
    PRISM_INITIAL_POINTER,
    { x: 0, y: 0, inside: true },
    "Prism pointer reset constant drifted",
  );
  assertEqual(
    PRISM_INITIAL_EULER,
    [0, 0, 0],
    "Prism Euler reset constant drifted",
  );
  assertEqual(
    PRISM_INITIAL_ROTATION,
    [1, 0, 0, 0, 1, 0, 0, 0, 1],
    "Prism rotation reset constant drifted",
  );
  assert(
    shouldResetPrismAnimationState("rotate", "hover"),
    "Prism animation-mode transition stopped resetting remount state",
  );
  assert(
    !shouldResetPrismAnimationState("hover", "hover"),
    "Prism state reset leaked into unrelated same-mode updates",
  );

  const cachedSize = {
    cssWidth: 1280,
    cssHeight: 720,
    effectiveDpr: 2,
    renderScale: 0.55,
  };
  assert(
    shouldResizeOglBacking(null, cachedSize),
    "initial OGL backing size was treated as cached",
  );
  assert(
    !shouldResizeOglBacking(cachedSize, { ...cachedSize }),
    "unchanged OGL backing size triggered reallocation",
  );
  assert(
    shouldResizeOglBacking(cachedSize, { ...cachedSize, cssWidth: 1281 }),
    "CSS resize did not invalidate OGL backing size",
  );
  assert(
    shouldResizeOglBacking(cachedSize, { ...cachedSize, effectiveDpr: 1 }),
    "DPR change did not invalidate OGL backing size",
  );
  assert(
    shouldResizeOglBacking(cachedSize, { ...cachedSize, renderScale: 0.5 }),
    "render scale change did not invalidate OGL backing size",
  );
  assert(
    shouldContinueOglAnimation(1, false),
    "positive-speed Aurora animation was stopped",
  );
  assert(
    !shouldContinueOglAnimation(0, false),
    "zero-speed Aurora animation kept scheduling after its render",
  );

  assert(
    !shouldContinueOglAnimation(1, true),
    "reduced-motion OGL animation kept scheduling",
  );
  assert(
    Math.abs(gradientBlindsAngleRadians(360) - Math.PI * 2) < 1e-12,
    "Gradient Blinds complete angle range stopped mapping to radians",
  );
  assert(
    effectiveBlindCount(599, 16, 60) === 9 &&
      effectiveBlindCount(100, 0, 0) === 1,
    "Gradient Blinds minimum-width count math drifted",
  );
  assert(
    Math.abs(gradientBlindsDampingFactor(0.15, 0.15) - (1 - Math.exp(-1))) <
      1e-12,
    "Gradient Blinds pointer damping drifted",
  );
  const retainedBlindTarget = new Float32Array([640, 360]);
  const recreatedBlindState = gradientBlindsRecreationTransition(
    retainedBlindTarget,
    false,
    12_345,
  );
  assertEqual(
    recreatedBlindState.iMouse,
    [0, 0],
    "Gradient Blinds recreation preserved current pointer state",
  );
  assert(
    recreatedBlindState.iTime === 0,
    "Gradient Blinds recreation preserved effect-local time state",
  );
  assert(
    recreatedBlindState.mouseTarget === retainedBlindTarget,
    "Gradient Blinds recreation replaced its persistent pointer target ref",
  );
  assert(
    !recreatedBlindState.firstResize && recreatedBlindState.lastTime === 12_345,
    "Gradient Blinds recreation reset persistent React-ref state",
  );

  const blindState = {
    config: effectiveBackgroundConfig("gradient-blinds", {}),
    palette: {
      paper: [0, 0, 0],
      paperHex: "#000000",
      ink: [1, 1, 1],
      inkHex: "#ffffff",
      accent: [1, 0, 0],
      accentHex: "#ff0000",
      focus: [0, 0, 1],
      focusHex: "#0000ff",
    } as ThemePalette,
  };
  const blindDependencies = gradientBlindsDependencyValues(blindState);
  assert(
    !gradientBlindsDependenciesChanged(
      blindDependencies,
      gradientBlindsDependencyValues({
        config: { ...blindState.config },
        palette: {
          ...blindState.palette,
          accent: [...blindState.palette.accent],
          focus: [...blindState.palette.focus],
        },
      }),
    ),
    "fresh same-value Gradient Blinds objects triggered recreation",
  );
  assert(
    gradientBlindsDependenciesChanged(
      blindDependencies,
      gradientBlindsDependencyValues({
        ...blindState,
        config: { ...blindState.config, angle: 21 },
      }),
    ),
    "Gradient Blinds control change stopped triggering recreation",
  );
  assert(
    gradientBlindsDependenciesChanged(
      blindDependencies,
      gradientBlindsDependencyValues({
        ...blindState,
        palette: { ...blindState.palette, accent: [0.9, 0, 0] },
      }),
    ),
    "Gradient Blinds palette change stopped triggering recreation",
  );
  assert(
    strandsGlassRadius(1) === 0.46 && strandsGlassRadius(0.5) === 0.23,
    "Strands glass radius drifted",
  );

  assert(
    gradientWavesDetailSteps("low") === 40 &&
      gradientWavesDetailSteps("medium") === 70 &&
      gradientWavesDetailSteps("high") === 110,
    "Gradient Waves detail mapping drifted",
  );
  assert(
    !shouldAnimateGrainient(0, false, 0.1, false),
    "static Grainient state kept scheduling",
  );
  assert(
    shouldAnimateGrainient(0, true, 0.1, false),
    "effective animated Grainient grain stopped scheduling",
  );
  assert(
    !shouldAnimateGrainient(0, true, 0, false),
    "zero-amount Grainient grain kept scheduling",
  );
  assert(
    shouldAnimateGrainient(1, true, 0, false),
    "positive-speed Grainient stopped scheduling",
  );
  assert(
    !shouldAnimateGrainient(1, true, 0.1, true),
    "reduced-motion Grainient kept scheduling",
  );
  assert(
    !shouldAnimateGradientWaves(0, false, 0.05, true, false),
    "static Gradient Waves state kept scheduling",
  );
  assert(
    shouldAnimateGradientWaves(0, true, 0.05, true, false),
    "effective Gradient Waves grain stopped scheduling",
  );
  assert(
    !shouldAnimateGradientWaves(0, true, 0, true, false),
    "zero-intensity Gradient Waves grain kept scheduling",
  );
  assert(
    shouldAnimateGradientWaves(0, false, 0, true, false, false),
    "active unsettled Gradient Waves pointer stopped scheduling",
  );
  assert(
    !shouldAnimateGradientWaves(0, false, 0, false, false, false),
    "disabled Gradient Waves pointer kept scheduling",
  );
  assert(
    shouldAnimateGradientWaves(1, false, 0, false, false),
    "positive-speed Gradient Waves stopped scheduling",
  );
  assert(
    !shouldAnimateGradientWaves(1, true, 0.05, true, true, false),
    "reduced-motion Gradient Waves kept scheduling",
  );
  assertEqual(
    LIQUID_CHROME_INITIAL_POINTER,
    [0, 0],
    "Liquid Chrome interaction reset drifted",
  );
  assertEqual(
    IRIDESCENCE_INITIAL_POINTER,
    [0.5, 0.5],
    "Iridescence interaction reset drifted",
  );

  const ditherStartTime = 1_000;
  let ditherTime = ditherElapsedTime(ditherStartTime, 2_500, true, 0);
  assert(
    ditherTime === 1.5,
    "enabled Dither time did not advance from its fixed start timestamp",
  );
  ditherTime = ditherElapsedTime(ditherStartTime, 8_000, false, ditherTime);
  assert(
    ditherTime === 1.5,
    "disabled Dither time did not freeze at its last uniform value",
  );
  ditherTime = ditherElapsedTime(ditherStartTime, 10_000, true, ditherTime);
  assert(
    ditherTime === 9,
    "re-enabled Dither time rebased or continued from its frozen value",
  );
});
import {
  numericControlAriaValues,
  numericControlKeyTransition,
  numericControlPercentage,
  numericControlPointerValue,
} from "../../src/ui/backgrounds/numeric-control";
import {
  shouldAnimateMeridianQuad,
  shouldRenderMeridianQuadFrame,
} from "../../src/effects/meridian-quad";
test("source runtime integrity: off-lattice control transitions and first-party static/throttle boundaries", () => {
  assert(
    shouldAnimateMeridianQuad(false, 721, 720, false, true),
    "Meridian quad stopped animating above its width threshold",
  );
  assert(
    !shouldAnimateMeridianQuad(true, 721, 720, false, true),
    "Meridian quad ignored reduced motion",
  );
  assert(
    !shouldAnimateMeridianQuad(false, 720, 720, false, true),
    "Meridian quad animated at its inclusive static width boundary",
  );
  assert(
    !shouldAnimateMeridianQuad(false, 721, 720, true, true),
    "Meridian quad ignored coarse-pointer static mode",
  );
  assert(
    shouldAnimateMeridianQuad(false, 721, 720, true, false),
    "Meridian quad applied coarse-pointer static mode without opt-in",
  );
  assert(
    !shouldRenderMeridianQuadFrame(true, 1016, 1000, 30),
    "Meridian quad frame throttle rendered too early",
  );
  assert(
    shouldRenderMeridianQuadFrame(true, 1034, 1000, 30),
    "Meridian quad frame throttle skipped a due frame",
  );
  assert(
    shouldRenderMeridianQuadFrame(false, 1000, 1000, 30),
    "Meridian quad static frame was throttled away",
  );
  assert(
    shouldRenderMeridianQuadFrame(true, 1000, 1000),
    "Meridian quad throttled without a target FPS",
  );

  assert(
    numericControlPercentage(30, 1, 25) === 120.83333333333333,
    "Beams off-range control percentage stopped matching PreviewSlider",
  );
  assertEqual(
    numericControlAriaValues(30, 1, 25),
    { valueNow: 25, valueText: "Effective value 30, above maximum 25" },
    "Beams off-range ARIA value stopped preserving its effective value and valid maximum",
  );
  assertEqual(
    numericControlAriaValues(0, 0.5, 5),
    { valueNow: 0.5, valueText: "Effective value 0, below minimum 0.5" },
    "Dark Veil off-range ARIA value stopped preserving its effective value and valid minimum",
  );
  assertEqual(
    numericControlAriaValues(5, 1, 25),
    { valueNow: 5, valueText: null },
    "in-range numeric control retained special ARIA value text",
  );
  assert(
    numericControlKeyTransition(30, "ArrowLeft", 1, 25, 1) === 25,
    "Beams first off-range ArrowLeft transition stopped clamping like PreviewSlider",
  );
  assert(
    numericControlKeyTransition(30, "ArrowRight", 1, 25, 1) === 25,
    "Beams first off-range ArrowRight transition stopped clamping like PreviewSlider",
  );
  assert(
    numericControlPointerValue(130, 100, 100, 1, 25, 1) === 8,
    "numeric control pointer rounding stopped matching PreviewSlider",
  );
});
