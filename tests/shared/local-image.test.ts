import { expect, test } from "bun:test";
import {
  DEFAULT_LOCAL_IMAGE,
  isLocalImageAssetId,
  unsupportedLocalImage,
  normalizeLocalImage,
  backgroundRevision,
  BACKGROUND_FIELDS,
  hasBackgroundPatch,
  IMAGE_CONFLICT,
  IMAGE_LOCK_REASON,
  type LocalImageSettings,
} from "../../src/shared/local-image";

const assetId = "12345678-1234-4123-8123-123456789abc";

test("local-image-state.ts keeps version/reference/fit/Original defaults, never pixels or URLs", () => {
  expect(DEFAULT_LOCAL_IMAGE).toEqual({
    version: 1,
    assetId: null,
    fit: "cover",
    filter: "none",
    filterOverrides: {},
  });
  for (const value of [undefined, null, false, 1, [], {}, "remote"])
    expect(normalizeLocalImage(value)).toEqual(DEFAULT_LOCAL_IMAGE);
  expect(
    normalizeLocalImage({
      version: 1,
      assetId: "https://remote/image.png",
      fit: "stretch",
      filter: "paper-dithering",
      image: "pixels",
    }),
  ).toEqual(DEFAULT_LOCAL_IMAGE);
  if (!isLocalImageAssetId(assetId))
    throw new Error("Fixture must be a v4 asset ID");
  const settings = {
    version: 1,
    assetId,
    fit: "contain",
    filter: "paper-image-water",
    filterOverrides: {
      "paper-image-water": { waves: 0.55 },
      "paper-image-halftone-dots": { grid: "square" },
    },
  } satisfies LocalImageSettings;
  expect(normalizeLocalImage(settings)).toEqual(settings);
  const normalized = normalizeLocalImage(undefined);
  normalized.filterOverrides["paper-image-water"] = { waves: 0.5 };
  expect(DEFAULT_LOCAL_IMAGE.filterOverrides).toEqual({});
});

test("asset IDs are case-insensitive RFC v4 references, not loose strings", () => {
  expect(isLocalImageAssetId(assetId)).toBe(true);
  expect(isLocalImageAssetId(assetId.toUpperCase())).toBe(true);
  for (const value of [
    "",
    "blob:local",
    "../image",
    "12345678-1234-1123-8123-123456789abc",
    "12345678-1234-4123-7123-123456789abc",
    `${assetId}x`,
    ` ${assetId}`,
    0,
    null,
    {},
  ])
    expect(isLocalImageAssetId(value)).toBe(false);
});

test("unsupportedLocalImage distinguishes missing data from unknown schema before normalization", () => {
  expect(unsupportedLocalImage(undefined)).toBe(false);
  expect(unsupportedLocalImage({ version: 1 })).toBe(false);
  for (const value of [
    null,
    {},
    [],
    false,
    "1",
    1,
    { version: "1" },
    { version: 0 },
    { version: 2 },
  ])
    expect(unsupportedLocalImage(value)).toBe(true);
  // Native storage must check unsupportedLocalImage first to preserve an unknown schema.
  expect(normalizeLocalImage({ version: 2 })).toEqual(DEFAULT_LOCAL_IMAGE);
});

test("backgroundRevision accepts only nonnegative safe integers and field ownership keeps source semantics", () => {
  for (const value of [0, 1, Number.MAX_SAFE_INTEGER])
    expect(backgroundRevision(value)).toBe(value);
  for (const value of [
    -1,
    0.5,
    NaN,
    Infinity,
    -Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    "1",
    null,
    undefined,
    {},
    [],
  ])
    expect(backgroundRevision(value)).toBe(0);
  expect(Object.is(backgroundRevision(-0), -0)).toBe(true);
  expect(BACKGROUND_FIELDS).toEqual([
    "background",
    "backgroundOverrides",
    "localImage",
  ]);
  for (const key of BACKGROUND_FIELDS)
    expect(hasBackgroundPatch({ [key]: undefined })).toBe(true);
  expect(hasBackgroundPatch({ backgroundRevision: 1 })).toBe(false);
  expect(hasBackgroundPatch({ theme: "midnight" })).toBe(false);
  const inheritedPatch = {};
  Object.setPrototypeOf(inheritedPatch, { background: "ink" });
  expect(hasBackgroundPatch(inheritedPatch)).toBe(true);
  expect(IMAGE_CONFLICT).toBe(
    "Background changed in another tab. Choose the image again.",
  );
  expect(IMAGE_LOCK_REASON).toBe(
    "Image changes require Web Locks, unavailable in this browser.",
  );
});
