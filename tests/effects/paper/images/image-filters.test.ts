import { requiredValue } from "../../../../src/effects/runtime/required-value";
import { test, expect } from "bun:test";
import {
  PAPER_IMAGE_FILTER_IDS,
  PAPER_IMAGE_FILTERS,
  normalizeImageFilterOverrides,
  effectiveImageFilter,
} from "../../../../src/shared/image-filter-metadata";
import { imageFilterUniforms } from "../../../../src/effects/paper/images/uniforms";
import { filterTextureDimensions } from "../../../../src/effects/paper/images/adapter";
import {
  DEFAULT_LOCAL_IMAGE,
  type LocalImageAssetId,
} from "../../../../src/shared/local-image";
import {
  DEFAULT_SETTINGS,
  mergeSettingsPatch,
  createPatchOwnership,
  ownPatch,
  failedOwnedPatch,
  type Settings,
} from "../../../../src/domain/settings/schema";
import {
  BackgroundOwnership,
  reconcileBackgroundPublication,
} from "../../../../src/domain/settings/background-ownership";
const assetId = "12345678-1234-4123-8123-123456789abc" as LocalImageAssetId;
const initial: Settings = {
  ...DEFAULT_SETTINGS,
  background: "local-image",
  localImage: { ...DEFAULT_LOCAL_IMAGE, assetId },
};
for (const id of PAPER_IMAGE_FILTER_IDS) {
  test(`${id} exact defaults survive validation and every official control is bounded`, () => {
    const definition = PAPER_IMAGE_FILTERS[id];
    expect(normalizeImageFilterOverrides(id, definition.defaults)).toEqual({});
    expect(effectiveImageFilter(id, {})).toEqual(definition.defaults);
    for (const c of definition.controls) {
      if (c.type === "number") {
        expect(
          effectiveImageFilter(id, { [id]: { [c.key]: -1e9 } })[c.key],
        ).toBe(c.min);
        expect(
          effectiveImageFilter(id, { [id]: { [c.key]: 1e9 } })[c.key],
        ).toBe(c.max);
        expect(normalizeImageFilterOverrides(id, { [c.key]: NaN })).toEqual({});
      } else if (c.type === "select")
        for (const option of c.options) {
          const s = {
            ...initial.localImage,
            filter: id,
            filterOverrides: { [id]: { [c.key]: option.value } },
          };
          const uniforms = imageFilterUniforms(id, s);
          expect(uniforms[`u_${c.key}`]).toBe(
            requiredValue(definition.enums[c.key]).indexOf(option.value) +
              definition.enumBase,
          );
        }
    }
    expect(
      normalizeImageFilterOverrides(id, {
        bad: 1,
        u_image: "remote",
        image: "remote",
        scale: 1e9,
      }),
    ).toEqual({});
  });
}
test("seven namespaced image filters, 103 effect props plus Water speed, no procedural aliases", () => {
  expect(PAPER_IMAGE_FILTER_IDS).toHaveLength(7);
  expect(
    Object.values(PAPER_IMAGE_FILTERS).reduce(
      (n, d) => n + d.controls.length,
      0,
    ),
  ).toBe(104);
  expect(DEFAULT_LOCAL_IMAGE.filter).toBe("none");
  expect(
    imageFilterUniforms("paper-image-image-dithering", initial.localImage)
      .u_pxSize,
  ).toBe(2);
  expect(
    imageFilterUniforms("paper-image-water", {
      ...initial.localImage,
      fit: "contain",
    }).u_fit,
  ).toBe(1);
  expect(
    imageFilterUniforms("paper-image-water", initial.localImage).u_scale,
  ).toBe(1);
  const cmyk = imageFilterUniforms(
    "paper-image-halftone-cmyk",
    initial.localImage,
  );
  expect(cmyk.u_colorC).not.toEqual(cmyk.u_colorM);
  const glass = imageFilterUniforms("paper-image-fluted-glass", {
    ...initial.localImage,
    filterOverrides: {
      "paper-image-fluted-glass": { margin: 0.3, marginLeft: 0.7 },
    },
  });
  expect(glass.u_marginRight).toBe(0.3);
  expect(glass.u_marginLeft).toBe(0.7);
  const zeroSide = normalizeImageFilterOverrides("paper-image-fluted-glass", {
    margin: 0.3,
    marginLeft: 0,
  });
  expect(zeroSide.marginLeft).toBe(0);
  expect(
    imageFilterUniforms("paper-image-fluted-glass", {
      ...initial.localImage,
      filterOverrides: { "paper-image-fluted-glass": zeroSide },
    }).u_marginLeft,
  ).toBe(0);
});
test("filter-only lock merge preserves latest source, fit and unselected override scopes; reset one scope", () => {
  const latest = {
    ...initial,
    localImage: {
      ...initial.localImage,
      fit: "contain" as const,
      filterOverrides: { "paper-image-water": { waves: 0.7 } },
    },
  };
  const edited = mergeSettingsPatch(latest, {
    backgroundRevision: 0,
    localImage: {
      ...initial.localImage,
      fit: "cover",
      filter: "paper-image-lens-distortion",
      filterOverrides: {
        "paper-image-lens-distortion": { count: 7 },
        "paper-image-water": { waves: 0.1 },
      },
    },
  });
  expect(edited.localImage.fit).toBe("contain");
  expect(edited.localImage.assetId).toBe(assetId);
  expect(edited.localImage.filterOverrides["paper-image-water"]).toEqual({
    waves: 0.7,
  });
  expect(edited.background).toBe("local-image");
  expect(edited.backgroundRevision).toBe(1);
  const reset = mergeSettingsPatch(edited, {
    backgroundRevision: 1,
    localImage: { ...edited.localImage, filterOverrides: {} },
  });
  expect(reset.localImage.filterOverrides["paper-image-water"]).toEqual({
    waves: 0.7,
  });
  expect(
    reset.localImage.filterOverrides["paper-image-lens-distortion"],
  ).toBeUndefined();
  expect(() =>
    mergeSettingsPatch(
      { ...edited, background: "none" },
      { backgroundRevision: 1, localImage: edited.localImage },
    ),
  ).toThrow();
  expect(() =>
    mergeSettingsPatch(edited, {
      backgroundRevision: 0,
      localImage: edited.localImage,
    }),
  ).toThrow();
});
test("filter intents advance only acknowledged own edges; external remove clears conflicting ownership", () => {
  const owner = new BackgroundOwnership(initial),
    fields = createPatchOwnership<Settings>();
  const intent = owner.intent(0);
  const own = mergeSettingsPatch(initial, {
    backgroundRevision: 0,
    localImage: { ...initial.localImage, filter: "paper-image-water" },
  });
  owner.prepared(initial, own);
  owner.observe(own);
  expect(owner.resolve(intent)).toBe(0);
  owner.acknowledged(own);
  expect(owner.resolve(intent)).toBe(1);
  ownPatch(
    fields,
    { localImage: own.localImage, backgroundRevision: 1 },
    "failed",
  );
  const external = mergeSettingsPatch(own, {
    background: "none",
    localImage: { ...DEFAULT_LOCAL_IMAGE },
  });
  expect(
    reconcileBackgroundPublication(external, owner, fields).ownershipCleared,
  ).toBe(true);
  expect(failedOwnedPatch(fields)).toEqual({});
  expect(() => owner.resolve(intent)).toThrow();
});
test("filter derivative uses owning texture edge and 2MP area caps without upscale", () => {
  expect(filterTextureDimensions(5000, 100, 4096)).toEqual({
    width: 4096,
    height: 81,
  });
  expect(filterTextureDimensions(320, 200, 4096)).toEqual({
    width: 320,
    height: 200,
  });
  for (const limit of [64, 1024, 4096, 16384]) {
    const d = filterTextureDimensions(8000, 3000, limit);
    expect(Math.max(d.width, d.height)).toBeLessThanOrEqual(limit);
    expect(d.width * d.height).toBeLessThanOrEqual(2073600);
  }
  expect(() => filterTextureDimensions(1, 1, NaN)).toThrow();
});
