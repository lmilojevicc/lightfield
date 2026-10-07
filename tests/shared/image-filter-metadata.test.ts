import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  PAPER_IMAGE_FILTER_IDS,
  PAPER_IMAGE_FILTERS,
  isPaperImageFilter,
  normalizeImageFilterOverrides,
  normalizeImageFilterMap,
  effectiveImageFilter,
  type ImageFilterOverrides,
} from "../../src/shared/image-filter-metadata";

test("registry.ts seven filter exports preserve all 104 controls and exact defaults/enum/mipmap metadata", () => {
  // Captured from source registry exports at 3e3116215c98475e3ee5c4043119ff6b86aa211f.
  expect(
    createHash("sha256")
      .update(JSON.stringify(PAPER_IMAGE_FILTERS))
      .digest("hex"),
  ).toBe("06b1632dc3d62df27a9e8d437213387f6e7525da7af83ecc09ae174ab0c68503");
  expect(PAPER_IMAGE_FILTER_IDS).toHaveLength(7);
  expect(new Set(PAPER_IMAGE_FILTER_IDS).size).toBe(7);
  expect(Object.keys(PAPER_IMAGE_FILTERS)).toEqual([...PAPER_IMAGE_FILTER_IDS]);
  expect(
    Object.values(PAPER_IMAGE_FILTERS).reduce(
      (sum, definition) => sum + definition.controls.length,
      0,
    ),
  ).toBe(104);
  for (const id of PAPER_IMAGE_FILTER_IDS)
    expect(isPaperImageFilter(id)).toBe(true);
  for (const id of [
    "none",
    "Original",
    "paper-dithering",
    "toString",
    "__proto__",
    null,
    1,
    {},
  ])
    expect(isPaperImageFilter(id)).toBe(false);
  expect(PAPER_IMAGE_FILTERS["paper-image-water"].defaults.speed).toBe(1);
});

for (const id of PAPER_IMAGE_FILTER_IDS) {
  test(`${id}: default elision, bounded numbers, exact enums and unknown-field rejection`, () => {
    const definition = PAPER_IMAGE_FILTERS[id];
    expect(normalizeImageFilterOverrides(id, definition.defaults)).toEqual({});
    expect(effectiveImageFilter(id, {})).toEqual(definition.defaults);
    expect(
      new Set(definition.controls.map((control) => control.key)).size,
    ).toBe(definition.controls.length);
    for (const control of definition.controls) {
      for (const value of [null, undefined, NaN, Infinity, -Infinity, {}, []])
        expect(
          normalizeImageFilterOverrides(id, { [control.key]: value }),
        ).toEqual({});
      if (control.type === "number") {
        expect(Number.isFinite(definition.defaults[control.key])).toBe(true);
        expect(
          effectiveImageFilter(id, { [id]: { [control.key]: -1e9 } })[
            control.key
          ],
        ).toBe(control.min);
        expect(
          effectiveImageFilter(id, { [id]: { [control.key]: 1e9 } })[
            control.key
          ],
        ).toBe(control.max);
        const unsnapped =
          control.min + (control.max - control.min) * 0.3141592653589793;
        expect(
          effectiveImageFilter(id, { [id]: { [control.key]: unsnapped } })[
            control.key
          ],
        ).toBe(control.step === 1 ? Math.round(unsnapped) : unsnapped);
      } else if (control.type === "select") {
        expect(definition.enums[control.key]).toEqual(
          control.options.map((option) => option.value),
        );
        for (const option of control.options)
          expect(
            effectiveImageFilter(id, { [id]: { [control.key]: option.value } })[
              control.key
            ],
          ).toBe(option.value);
        expect(
          normalizeImageFilterOverrides(id, {
            [control.key]: "invalid-option",
          }),
        ).toEqual({});
      } else if (control.type === "boolean") {
        for (const value of [true, false])
          expect(
            effectiveImageFilter(id, { [id]: { [control.key]: value } })[
              control.key
            ],
          ).toBe(value);
        expect(normalizeImageFilterOverrides(id, { [control.key]: 1 })).toEqual(
          {},
        );
      } else {
        for (const value of ["#aBcDeF", "#00000000"])
          expect(
            effectiveImageFilter(id, { [id]: { [control.key]: value } })[
              control.key
            ],
          ).toBe(value);
        for (const value of [
          "#fff",
          "#abcd",
          "red",
          "rgb(0,0,0)",
          " #abcdef",
          "#abcdef ",
          "#zzzzzz",
        ])
          expect(
            normalizeImageFilterOverrides(id, { [control.key]: value }),
          ).toEqual({});
      }
    }
    expect(
      normalizeImageFilterOverrides(id, {
        bad: 1,
        u_image: "remote",
        image: "remote",
        scale: 1e9,
        frame: 1e9,
      }),
    ).toEqual({});
  });
}

test("integer controls round; fractional controls do not; fluted-glass zero-side margin remains authoritative", () => {
  expect(
    normalizeImageFilterOverrides("paper-image-lens-distortion", {
      count: 7.4,
    }),
  ).toEqual({ count: 7 });
  expect(
    normalizeImageFilterOverrides("paper-image-water", { waves: 0.314159265 }),
  ).toEqual({ waves: 0.314159265 });
  expect(
    normalizeImageFilterOverrides("paper-image-fluted-glass", {
      margin: 0.3,
      marginLeft: 0,
      marginRight: 0.7,
    }),
  ).toEqual({ margin: 0.3, marginLeft: 0, marginRight: 0.7 });
  expect(
    normalizeImageFilterOverrides("paper-image-fluted-glass", {
      margin: 0,
      marginLeft: 0,
    }),
  ).toEqual({});
  expect(
    normalizeImageFilterOverrides("paper-image-fluted-glass", {
      margin: Infinity,
      marginLeft: 0,
    }),
  ).toEqual({});
  expect(
    normalizeImageFilterOverrides("paper-image-fluted-glass", { stretch: 0.5 }),
  ).toEqual({ stretch: 0.5 });
  expect(
    normalizeImageFilterOverrides("paper-image-lens-distortion", {
      lensCircle: 0.5,
    }),
  ).toEqual({ lensCircle: 0.5 });
});

test("filter map keeps unselected scopes and elides empty/default scopes without changing inputs", () => {
  const input = {
    "paper-image-water": { waves: 0.5 },
    "paper-image-halftone-dots": { type: "holes" },
    "paper-image-lens-distortion": { count: 35 },
    "paper-image-fluted-glass": {},
    none: { waves: 0.5 },
  };
  expect(normalizeImageFilterMap(input)).toEqual({
    "paper-image-water": { waves: 0.5 },
    "paper-image-halftone-dots": { type: "holes" },
  });
  expect(input["paper-image-lens-distortion"]).toEqual({ count: 35 });
  for (const value of [undefined, null, [], 0, false, "water"])
    expect(normalizeImageFilterMap(value)).toEqual({});
  const effective = effectiveImageFilter("paper-image-water", {});
  effective.waves = 0;
  expect(PAPER_IMAGE_FILTERS["paper-image-water"].defaults.waves).toBe(0.3);
});

test("pure persisted filter types retain native select unions and authored props", () => {
  const overrides = {
    "paper-image-fluted-glass": {
      shape: "linesIrregular",
      distortionShape: "cascade",
      stretch: 0.5,
      colorBack: "#00000000",
    },
    "paper-image-water": { speed: -0.5 },
    "paper-image-image-dithering": { type: "8x8", originalColors: true },
    "paper-image-halftone-dots": { type: "gooey", grid: "hex" },
    "paper-image-halftone-cmyk": { type: "sharp", gainY: 0.5 },
    "paper-image-lens-distortion": { lensCircle: 0.5 },
  } satisfies ImageFilterOverrides;
  expect(normalizeImageFilterMap(overrides)["paper-image-water"]).toEqual({
    speed: -0.5,
  });
  const badEnum: ImageFilterOverrides = {
    // @ts-expect-error Native Paper select values are not arbitrary strings.
    "paper-image-halftone-dots": { grid: "triangle" },
  };
  expect(normalizeImageFilterMap(badEnum)).toEqual({});
  const badImage: ImageFilterOverrides = {
    // @ts-expect-error User pixels/URLs never belong to persisted filter scalar settings.
    "paper-image-water": { image: "remote" },
  };
  expect(normalizeImageFilterMap(badImage)).toEqual({});
});
