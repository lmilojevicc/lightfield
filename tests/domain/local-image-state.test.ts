import { test, expect } from "bun:test";
import {
  DEFAULT_SETTINGS,
  mergeSettingsPatch,
  normalize,
  strictImageSettings,
} from "../../src/domain/settings/schema";
import { normalizeSettingsStore } from "../../src/services/settings-transactions";
import {
  DEFAULT_LOCAL_IMAGE,
  normalizeLocalImage,
  type LocalImageAssetId,
} from "../../src/shared/local-image";
import { BACKGROUND_IMPLEMENTATION_IDS } from "../../src/shared/background-metadata";
const id = "12345678-1234-4123-8123-123456789abc" as LocalImageAssetId;
test("local-image-state default, inactive retention, harmless unknown filters", () => {
  expect(normalize({}).localImage).toEqual(DEFAULT_LOCAL_IMAGE);
  expect(
    normalizeLocalImage({
      version: 1,
      assetId: "not-a-uuid",
      filter: "unknown",
      filterOverrides: { unknown: { speed: 1 } },
    }),
  ).toEqual(DEFAULT_LOCAL_IMAGE);
  for (const background of [
    "none",
    ...BACKGROUND_IMPLEMENTATION_IDS,
  ] as const) {
    const settings = normalize({
      background,
      localImage: { ...DEFAULT_LOCAL_IMAGE, assetId: id },
    });
    expect(settings.background).toBe(background);
    expect(settings.localImage.assetId).toBe(id);
  }
});
test("local-image-state revision only changes at central background boundary", () => {
  const image = mergeSettingsPatch(DEFAULT_SETTINGS, {
    background: "local-image",
    localImage: { ...DEFAULT_LOCAL_IMAGE, assetId: id },
  });
  expect(image.backgroundRevision).toBe(1);
  const unrelated = mergeSettingsPatch(image, {
    weatherLocation: "Fixture",
    backgroundRevision: 999,
  });
  expect(unrelated.backgroundRevision).toBe(1);
  expect(
    mergeSettingsPatch(image, {
      localImage: { ...image.localImage, fit: "contain" },
    }).backgroundRevision,
  ).toBe(2);
  expect(
    mergeSettingsPatch(image, { background: "local-image" }).backgroundRevision,
  ).toBe(1);
  expect(() =>
    mergeSettingsPatch(image, { background: "none", backgroundRevision: 0 }),
  ).toThrow("another tab");
});
test("local-image-state unsupported schema survives unrelated writes and normalization", async () => {
  const future = {
    ...DEFAULT_SETTINGS,
    localImage: { version: 9, assetId: id, future: [1, 2] },
  };
  let writes = 0;
  await normalizeSettingsStore(
    {
      read: () => Promise.resolve(future),
      write: () => {
        return Promise.resolve().then(() => {
          writes++;
        });
      },
    },
    (work) => work(),
  );
  expect(writes).toBe(0);
  expect(
    JSON.stringify(
      mergeSettingsPatch(future, { weatherLocation: "Other" }).localImage,
    ),
  ).toBe(JSON.stringify(future.localImage));
  expect(() => mergeSettingsPatch(future, { background: "none" })).toThrow(
    "unsupported",
  );
  expect(() => strictImageSettings(future)).toThrow("unsupported");
  expect(() => strictImageSettings({ backgroundRevision: NaN })).toThrow(
    "invalid",
  );
});
