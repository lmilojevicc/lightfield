import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  BACKGROUND_IDS,
  BACKGROUND_IMPLEMENTATION_IDS,
  BACKGROUND_REGISTRY,
  BACKGROUND_COLLECTIONS,
  DEFAULT_BACKGROUND_ID,
  effectiveBackgroundConfig,
  getBackgroundDescriptor,
  isBackgroundId,
  normalizeBackgroundOverrides,
} from "../../src/shared/background-metadata";
import { PAPER_DEFINITIONS } from "../../src/shared/paper-metadata";
import {
  PIXEL_PERFECT_IDS,
  normalizePixelPerfectConfig,
} from "../../src/shared/pixel-perfect-metadata";

// Export snapshots captured from catalog.ts at reference 3e3116215c98475e3ee5c4043119ff6b86aa211f.
// These freeze every ID/name/default/control/condition/order, not only inventory counts.
// Collection order intentionally puts the ten original lightfield shaders first.
test("catalog.ts exported descriptor and collection parity", () => {
  const digest = (value: unknown) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
  expect(digest(BACKGROUND_REGISTRY)).toBe(
    "1cd253397e371a311a779161318e25d4e863d140a455d3caf204f6125312eb74",
  );
  const sourceNamedCollections = BACKGROUND_COLLECTIONS.map((collection) =>
    collection.id === "meridian"
      ? { ...collection, name: "Meridian" }
      : collection,
  );
  expect(digest(sourceNamedCollections)).toBe(
    "aec866c93c9901986fdda2f2e08db60940f207fde43a17d927d1e0aabc2ecba3",
  );
  expect(
    BACKGROUND_COLLECTIONS.find((collection) => collection.id === "meridian")
      ?.name,
  ).toBe("lightfield");
});

test("86 selections, 84 derived procedural IDs, all families including release-blocked Pixel Perfect", () => {
  expect(BACKGROUND_IDS).toHaveLength(86);
  expect(new Set(BACKGROUND_IDS).size).toBe(86);
  expect(BACKGROUND_IMPLEMENTATION_IDS).toEqual(
    BACKGROUND_IDS.filter((id) => id !== "none" && id !== "local-image"),
  );
  expect(BACKGROUND_IMPLEMENTATION_IDS).toHaveLength(84);
  expect(
    BACKGROUND_COLLECTIONS.map((collection) => collection.ids.length),
  ).toEqual([10, 2, 24, 9, 26, 9, 6]);
  const collectionIds = BACKGROUND_COLLECTIONS.flatMap((collection) => [
    ...collection.ids,
  ]);
  expect(collectionIds).toHaveLength(86);
  expect(new Set(collectionIds)).toEqual(new Set(BACKGROUND_IDS));
  expect(PIXEL_PERFECT_IDS).toHaveLength(6);
  for (const id of PIXEL_PERFECT_IDS)
    expect(getBackgroundDescriptor(id).available).toBe(true);
  expect(DEFAULT_BACKGROUND_ID).toBe("ink");
  expect(getBackgroundDescriptor("beams").name).not.toBe(
    getBackgroundDescriptor("seamlessBeams").name,
  );
  for (const id of BACKGROUND_IDS) {
    expect(isBackgroundId(id)).toBe(true);
    expect(getBackgroundDescriptor(id).id).toBe(id);
  }
  for (const id of [
    "",
    "toString",
    "__proto__",
    "seamless-beams",
    "neat",
    null,
    0,
    {},
    [],
  ])
    expect(isBackgroundId(id)).toBe(false);
});

test("controls have unique keys, typed defaults and valid constraints without rewriting out-of-slider source defaults", () => {
  const outsideBounds: string[] = [];
  for (const descriptor of BACKGROUND_REGISTRY) {
    expect(
      new Set(descriptor.controls.map((control) => control.key)).size,
    ).toBe(descriptor.controls.length);
    for (const control of descriptor.controls) {
      const value = descriptor.defaults[control.key];
      if (control.type === "number") {
        expect(typeof value).toBe("number");
        expect(Number.isFinite(value)).toBe(true);
        expect(control.min).toBeLessThanOrEqual(control.max);
        expect(control.step).toBeGreaterThan(0);
        if (
          typeof value === "number" &&
          (value < control.min || value > control.max)
        )
          outsideBounds.push(
            `${descriptor.id}.${control.key}=${String(value)}`,
          );
      } else if (control.type === "boolean")
        expect(typeof value).toBe("boolean");
      else {
        expect(control.options.some((option) => option.value === value)).toBe(
          true,
        );
        expect(
          new Set(control.options.map((option) => option.value)).size,
        ).toBe(control.options.length);
      }
      for (const condition of [control.disabledWhen, control.hiddenWhen]) {
        if (condition)
          expect(Object.hasOwn(descriptor.defaults, condition.key)).toBe(true);
      }
    }
  }
  expect(outsideBounds).toEqual([
    "dark-veil.scanlineFrequency=0",
    "beams.beamHeight=30",
    "seamlessBeams.beamHeight=30",
  ]);
});

for (const descriptor of BACKGROUND_REGISTRY) {
  test(`${descriptor.id}: catalog override validation clamps but never quantizes`, () => {
    for (const control of descriptor.controls) {
      const input = (value: unknown) => ({
        [descriptor.id]: { [control.key]: value, unknown: 1 },
      });
      for (const value of [null, undefined, NaN, Infinity, -Infinity, {}, []])
        expect(normalizeBackgroundOverrides(input(value))).toEqual({});
      if (control.type === "number") {
        expect(
          normalizeBackgroundOverrides(input(-1e9))[descriptor.id]?.[
            control.key
          ],
        ).toBe(control.min);
        expect(
          normalizeBackgroundOverrides(input(1e9))[descriptor.id]?.[
            control.key
          ],
        ).toBe(control.max);
        const unsnapped =
          control.min + (control.max - control.min) * 0.3141592653589793;
        expect(
          normalizeBackgroundOverrides(input(unsnapped))[descriptor.id]?.[
            control.key
          ],
        ).toBe(unsnapped);
        expect(normalizeBackgroundOverrides(input("1"))).toEqual({});
      } else if (control.type === "boolean") {
        for (const value of [true, false])
          expect(
            normalizeBackgroundOverrides(input(value))[descriptor.id]?.[
              control.key
            ],
          ).toBe(value);
        expect(normalizeBackgroundOverrides(input(1))).toEqual({});
      } else {
        for (const option of control.options)
          expect(
            normalizeBackgroundOverrides(input(option.value))[descriptor.id]?.[
              control.key
            ],
          ).toBe(option.value);
        expect(normalizeBackgroundOverrides(input("invalid-option"))).toEqual(
          {},
        );
      }
    }
  });
}

test("effective configs preserve untouched defaults; normalization drops noncatalog fields without mutating input", () => {
  for (const value of [null, undefined, [], false, 0, "ink"])
    expect(normalizeBackgroundOverrides(value)).toEqual({});
  expect(
    normalizeBackgroundOverrides({
      ink: [],
      none: { opacity: 1 },
      "local-image": { opacity: 1 },
      unknown: { speed: 1 },
    }),
  ).toEqual({});
  const input = {
    ink: { opacity: 0.23456789, unknown: 7 },
    waves: { waveSpeedX: 0.0125 },
  };
  expect(normalizeBackgroundOverrides(input)).toEqual({
    ink: { opacity: 0.23456789 },
    waves: { waveSpeedX: 0.0125 },
  });
  expect(input.ink.unknown).toBe(7);
  const effective = effectiveBackgroundConfig("beams", {});
  expect(effective.beamHeight).toBe(30);
  effective.beamHeight = 1;
  expect(getBackgroundDescriptor("beams").defaults.beamHeight).toBe(30);
  expect(effectiveBackgroundConfig("none", {})).toEqual({});
  expect(effectiveBackgroundConfig("local-image", {})).toEqual({});
});

test("Paper metadata keeps static mesh distinct from animated radial, and Pixel Perfect direct config is bounded", () => {
  expect(PAPER_DEFINITIONS["paper-static-mesh-gradient"].animated).toBe(false);
  expect(PAPER_DEFINITIONS["paper-static-radial-gradient"].animated).toBe(true);
  expect(PAPER_DEFINITIONS["paper-grain-gradient"].noise).toBe(true);
  expect(
    normalizePixelPerfectConfig("pixel-perfect-dither-wave", {
      speed: Infinity,
      density: -1,
      pixelSize: 1.37,
      paused: true,
      interactive: "yes",
      unknown: 3,
    }),
  ).toEqual({
    pixelSize: 1.37,
    density: 0,
    speed: 1,
    interactive: true,
    paused: true,
  });
});

test("first-party shaders precede imported collections without removing personal sources", () => {
  expect(BACKGROUND_COLLECTIONS.map((c) => c.id)).toEqual([
    "meridian",
    "personal",
    "react-bits",
    "orbs",
    "neat",
    "paper",
    "pixel-perfect",
  ]);
  expect(BACKGROUND_COLLECTIONS[0]?.ids).toEqual([
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
  ]);
});
