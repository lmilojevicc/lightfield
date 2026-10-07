import {
  isPaperImageFilter,
  normalizeImageFilterMap,
  type PaperImageFilterId,
  type ImageFilterOverrides,
} from "./background-metadata";
/** Version 1 stores only an immutable local asset reference, never pixels or URLs. */
export type LocalImageAssetId = string & {
  readonly __localImageAssetId: unique symbol;
};
export interface LocalImageSettings {
  version: 1;
  assetId: LocalImageAssetId | null;
  fit: "cover" | "contain";
  filter: "none" | PaperImageFilterId;
  filterOverrides: ImageFilterOverrides;
}
export const DEFAULT_LOCAL_IMAGE: LocalImageSettings = {
  version: 1,
  assetId: null,
  fit: "cover",
  filter: "none",
  filterOverrides: {},
};
export function isLocalImageAssetId(
  value: unknown,
): value is LocalImageAssetId {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
export function unsupportedLocalImage(value: unknown): boolean {
  return (
    value !== undefined &&
    (!value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Reflect.get(value, "version") !== 1)
  );
}
export function normalizeLocalImage(value: unknown): LocalImageSettings {
  const r = value && typeof value === "object" ? value : {};
  const assetId: unknown = Reflect.get(r, "assetId");
  const filter: unknown = Reflect.get(r, "filter");
  return {
    version: 1,
    assetId: isLocalImageAssetId(assetId) ? assetId : null,
    fit: Reflect.get(r, "fit") === "contain" ? "contain" : "cover",
    filter: isPaperImageFilter(filter) ? filter : "none",
    filterOverrides: normalizeImageFilterMap(Reflect.get(r, "filterOverrides")),
  };
}
export function backgroundRevision(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}
export const BACKGROUND_FIELDS = [
  "background",
  "backgroundOverrides",
  "localImage",
] as const;
export function hasBackgroundPatch(patch: object): boolean {
  return BACKGROUND_FIELDS.some((key) => key in patch);
}
export const IMAGE_CONFLICT =
  "Background changed in another tab. Choose the image again.";
export const IMAGE_LOCK_REASON =
  "Image changes require Web Locks, unavailable in this browser.";
