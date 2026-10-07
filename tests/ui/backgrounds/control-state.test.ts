import { numericControlNeedsAdapter } from "../../../src/ui/backgrounds/numeric-control";
import { describe, test, expect } from "bun:test";
import { DEFAULT_SETTINGS } from "../../../src/domain/settings/schema";
import {
  BACKGROUND_IDS,
  getBackgroundDescriptor,
  PAPER_IMAGE_FILTER_IDS,
} from "../../../src/shared/background-metadata";
import {
  controlValues,
  selectedControls,
  tuningScope,
} from "../../../src/ui/backgrounds/control-state";
import {
  numericControlKeyTransition,
  numericControlAriaValues,
  numericControlPointerValue,
} from "../../../src/ui/backgrounds/numeric-control";
import type { LocalImageAssetId } from "../../../src/shared/local-image";

const assetId = "550e8400-e29b-41d4-a716-446655440000" as LocalImageAssetId;
describe("Background control selection and tuning ownership", () => {
  test("every selection resolves the shared authored controls and defaults", () => {
    expect(BACKGROUND_IDS).toHaveLength(86);
    for (const background of BACKGROUND_IDS) {
      const settings = { ...DEFAULT_SETTINGS, background };
      expect(selectedControls(settings)).toBe(
        getBackgroundDescriptor(background),
      );
      expect(controlValues(settings)).toEqual(
        getBackgroundDescriptor(background).defaults,
      );
    }
  });
  test("saved overrides affect only their selected background", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      background: "ink" as const,
      backgroundOverrides: { ink: { opacity: 0.2 }, smoke: { opacity: 0.8 } },
    };
    expect(controlValues(settings).opacity).toBe(0.2);
    expect(controlValues({ ...settings, background: "smoke" }).opacity).toBe(
      0.8,
    );
    expect(tuningScope(settings)).toBe("ink");
    expect(tuningScope({ ...settings, background: "none" })).toBeNull();
  });
  test("image asset and filter changes each invalidate a tuning scope", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      background: "local-image" as const,
      localImage: {
        ...DEFAULT_SETTINGS.localImage,
        assetId,
        filter: PAPER_IMAGE_FILTER_IDS[0],
      },
    };
    expect(tuningScope(settings)).not.toBeNull();
    expect(
      tuningScope({
        ...settings,
        localImage: { ...settings.localImage, assetId: null },
      }),
    ).toBeNull();
    expect(
      tuningScope({
        ...settings,
        localImage: { ...settings.localImage, filter: "none" },
      }),
    ).toBeNull();
    for (const filter of PAPER_IMAGE_FILTER_IDS.slice(1))
      expect(
        tuningScope({
          ...settings,
          localImage: { ...settings.localImage, filter },
        }),
      ).not.toBe(tuningScope(settings));
  });
  test("filter overrides stay separate from procedural overrides", () => {
    const filter = PAPER_IMAGE_FILTER_IDS[0];
    const settings = {
      ...DEFAULT_SETTINGS,
      background: "local-image" as const,
      localImage: {
        ...DEFAULT_SETTINGS.localImage,
        assetId,
        filter,
        filterOverrides: { [filter]: { contrast: 0.7 } },
      },
    };
    expect(controlValues(settings).contrast).toBe(0.7);
    expect(controlValues({ ...settings, background: "ink" })).toEqual(
      getBackgroundDescriptor("ink").defaults,
    );
  });
});
describe("Numeric control bounded interaction", () => {
  test("keyboard supports arrows, Home/End and ignores unrelated keys", () => {
    expect(numericControlKeyTransition(0.34, "ArrowRight", 0, 1, 0.1)).toBe(
      0.4,
    );
    expect(numericControlKeyTransition(0.34, "ArrowDown", 0, 1, 0.1)).toBe(0.2);
    expect(numericControlKeyTransition(3, "Home", 0, 1, 0.1)).toBe(0);
    expect(numericControlKeyTransition(-2, "End", 0, 1, 0.1)).toBe(1);
    expect(numericControlKeyTransition(1, "ArrowUp", 0, 1, 0.1)).toBe(1);
    expect(numericControlKeyTransition(0, "ArrowLeft", 0, 1, 0.1)).toBe(0);
    expect(numericControlKeyTransition(0.3, "Tab", 0, 1, 0.1)).toBeNull();
  });
  test("authored out-of-bounds values remain effective but truthful in ARIA", () => {
    expect(numericControlAriaValues(2, 0, 1)).toEqual({
      valueNow: 1,
      valueText: "Effective value 2, above maximum 1",
    });
    expect(numericControlAriaValues(-1, 0, 1)).toEqual({
      valueNow: 0,
      valueText: "Effective value -1, below minimum 0",
    });
    expect(numericControlAriaValues(0.333, 0, 1)).toEqual({
      valueNow: 0.333,
      valueText: null,
    });
  });
  test("pointer rounds from minimum and clamps outside the rail", () => {
    expect(numericControlPointerValue(160, 100, 100, 0, 1, 0.1)).toBe(0.6);
    expect(numericControlPointerValue(50, 100, 100, 0, 1, 0.1)).toBe(0);
    expect(numericControlPointerValue(300, 100, 100, 0, 1, 0.1)).toBe(1);
  });
});

test("same-scope external Neat reset requires an adapter for the exact authored speed", () => {
  expect(numericControlNeedsAdapter(1, "neat-alejandra", 0, 10, 0.1)).toBe(
    false,
  );
  expect(
    numericControlNeedsAdapter(
      0.14868691165357314,
      "neat-alejandra",
      0,
      10,
      0.1,
    ),
  ).toBe(true);
  expect(numericControlNeedsAdapter(1, "neat-alejandra", 0, 10, 0.1)).toBe(
    false,
  );
});
