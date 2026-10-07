import { requiredValue } from "../required-value";
import { isCustomThemeName } from "../themes/custom-themes";
import {
  DEFAULT_LOCAL_IMAGE,
  normalizeLocalImage,
  unsupportedLocalImage,
  backgroundRevision,
  hasBackgroundPatch,
  IMAGE_CONFLICT,
  type LocalImageSettings,
} from "../../shared/local-image";
import {
  isFontPairing,
  RETIRED_FONT_PRESETS,
  type FontPairing,
} from "../fonts/font-pairings";
export type { FontPairing } from "../fonts/font-pairings";
export type SearchEngine =
  | "google"
  | "duckduckgo"
  | "bing"
  | "brave"
  | "qwant"
  | "startpage"
  | "ecosia"
  | "kagi";
import { BUILTIN_THEME_IDS, type ThemeName } from "../../shared/theme";
export type {
  ThemeName,
  CustomTheme,
  CustomThemeContrastWarning,
  CustomThemeImportResult,
  CustomThemeSemanticTokens,
} from "../../shared/theme";
import type { CustomTheme } from "../../shared/theme";

import {
  DEFAULT_BACKGROUND_ID,
  isBackgroundId,
  normalizeBackgroundOverrides,
  type BackgroundId,
  type BackgroundOverrides,
} from "../../shared/background-metadata";

export type SettingsPresentation = "modal" | "drawer";
export type IslandMode = "normal" | "hidden";

export interface Settings {
  seconds: boolean;
  twentyFourHour: boolean;
  showDate: boolean;
  /** Keeps the capsule date expanded instead of revealing it on hover. */
  dateExpanded: boolean;
  showWeekday: boolean;
  showMonth: boolean;
  showDay: boolean;
  showYear: boolean;
  showSearch: boolean;
  showEffectShortcut: boolean;
  islandMode: IslandMode;
  showWeather: boolean;
  showWeatherLocation: boolean;
  uiTone: "auto" | "dark" | "light";
  glassBlur: number;
  searchEngine: SearchEngine;
  theme: string;
  fonts: FontPairing;
  weatherLocation: string;
  weatherUnits: "c" | "f";
  customDisplayFont: string;
  customBodyFont: string;
  background: BackgroundId;
  backgroundOverrides: BackgroundOverrides;
  backgroundRevision: number;
  localImage: LocalImageSettings;
  settingsPresentation: SettingsPresentation;
}

export const DEFAULT_SETTINGS: Settings = {
  seconds: false,
  twentyFourHour: false,
  showDate: true,
  dateExpanded: false,
  showWeekday: true,
  showMonth: true,
  showDay: true,
  showYear: true,
  showSearch: true,
  showEffectShortcut: true,
  islandMode: "normal",
  showWeather: false,
  showWeatherLocation: false,
  uiTone: "auto",
  glassBlur: 28,
  searchEngine: "google",
  theme: "midnight",
  fonts: "system",
  weatherLocation: "auto",
  weatherUnits: "c",
  customDisplayFont: "Cormorant Garamond",
  customBodyFont: "Inter",
  background: DEFAULT_BACKGROUND_ID,
  backgroundOverrides: {},
  backgroundRevision: 0,
  localImage: DEFAULT_LOCAL_IMAGE,
  settingsPresentation: "modal",
};

export function reconcileCustomThemeSelection(
  theme: string,
  customThemes: readonly CustomTheme[],
): string {
  return isCustomThemeName(theme) &&
    !customThemes.some((customTheme) => customTheme.id === theme)
    ? DEFAULT_SETTINGS.theme
    : theme;
}

export const STORAGE_KEY = "lightfield:settings";

export const SEARCH_URLS: Record<SearchEngine, (q: string) => string> = {
  google: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  duckduckgo: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
  bing: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
  brave: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}`,
  qwant: (q) => `https://www.qwant.com/?q=${encodeURIComponent(q)}`,
  startpage: (q) =>
    `https://www.startpage.com/sp/search?query=${encodeURIComponent(q)}`,
  ecosia: (q) => `https://www.ecosia.org/search?q=${encodeURIComponent(q)}`,
  kagi: (q) => `https://kagi.com/search?q=${encodeURIComponent(q)}`,
};

function isSearchEngine(v: unknown): v is SearchEngine {
  return (
    v === "google" ||
    v === "duckduckgo" ||
    v === "bing" ||
    v === "brave" ||
    v === "qwant" ||
    v === "startpage" ||
    v === "ecosia" ||
    v === "kagi"
  );
}

const THEMES: readonly string[] = BUILTIN_THEME_IDS;

function isTheme(v: unknown): v is ThemeName {
  return typeof v === "string" && THEMES.includes(v);
}

function isWeatherUnits(v: unknown): v is "c" | "f" {
  return v === "c" || v === "f";
}

export function normalize(raw: unknown): Settings {
  const r = (raw ?? {}) as Record<string, unknown>;
  const out: Settings = { ...DEFAULT_SETTINGS };

  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const v = r[key];
    if (v === undefined) continue;
    switch (key) {
      case "searchEngine":
        if (isSearchEngine(v)) out.searchEngine = v;
        break;
      case "theme":
        if (typeof v === "string" && (isTheme(v) || isCustomThemeName(v))) {
          out.theme = v;
        }
        break;
      case "fonts":
        if (isFontPairing(v)) out.fonts = v;
        else if (
          typeof v === "string" &&
          Object.hasOwn(RETIRED_FONT_PRESETS, v)
        )
          out.fonts = requiredValue(RETIRED_FONT_PRESETS[v]);
        break;
      case "weatherLocation":
        if (typeof v === "string") out.weatherLocation = v.slice(0, 80);
        break;
      case "weatherUnits":
        if (isWeatherUnits(v)) out.weatherUnits = v;
        break;
      case "customDisplayFont":
        if (typeof v === "string") out.customDisplayFont = v.slice(0, 60);
        break;
      case "customBodyFont":
        if (typeof v === "string") out.customBodyFont = v.slice(0, 60);
        break;
      case "background":
        if (isBackgroundId(v)) out.background = v;
        break;
      case "uiTone":
        if (v === "auto" || v === "dark" || v === "light") out.uiTone = v;
        break;
      case "glassBlur":
        if (typeof v === "number" && Number.isFinite(v))
          out.glassBlur = Math.min(44, Math.max(8, Math.round(v / 2) * 2));
        break;
      case "islandMode":
        if (v === "normal" || v === "hidden") out.islandMode = v;
        break;
      case "settingsPresentation":
        if (v === "modal" || v === "drawer") out.settingsPresentation = v;
        break;
      case "localImage":
        out.localImage = normalizeLocalImage(v);
        break;
      case "backgroundRevision":
        out.backgroundRevision = backgroundRevision(v);
        break;
      case "backgroundOverrides":
        out.backgroundOverrides = normalizeBackgroundOverrides(v);
        break;
      default:
        if (typeof v === "boolean") out[key] = v;
    }
  }
  return out;
}

export type SettingsPatch = Partial<Settings>;

export type OwnedPatchPhase = "dirty" | "queued" | "in-flight" | "failed";
type OwnedPatchField<T> = {
  revision: number;
  value: T;
  phase: OwnedPatchPhase;
};
export interface PatchOwnership<T extends object> {
  nextRevision: number;
  fields: Partial<{ [K in keyof T]: OwnedPatchField<T[K]> }>;
}
export interface OwnedPatchAttempt<T extends object> {
  patch: Partial<T>;
  revisions: Partial<Record<keyof T, number>>;
}

export function createPatchOwnership<T extends object>(): PatchOwnership<T> {
  return { nextRevision: 0, fields: {} };
}

/** Claim each field immediately so storage echoes cannot replace dirty or in-flight UI state. */
export function ownPatch<T extends object>(
  ownership: PatchOwnership<T>,
  patch: Partial<T>,
  phase: OwnedPatchPhase = "queued",
): OwnedPatchAttempt<T> {
  const revision = ++ownership.nextRevision;
  const revisions: Partial<Record<keyof T, number>> = {};
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const value = patch[key];
    if (value === undefined) continue;
    ownership.fields[key] = { revision, value, phase };
    revisions[key] = revision;
  }
  return { patch, revisions };
}

export function setOwnedPatchPhase<T extends object>(
  ownership: PatchOwnership<T>,
  attempt: OwnedPatchAttempt<T>,
  phase: OwnedPatchPhase,
): void {
  for (const key of Object.keys(attempt.revisions) as (keyof T)[]) {
    const field = ownership.fields[key];
    if (field?.revision === attempt.revisions[key]) field.phase = phase;
  }
}

/** Settle only fields still owned by this exact attempt; newer edits keep ownership. */
export function settleOwnedPatch<T extends object>(
  ownership: PatchOwnership<T>,
  attempt: OwnedPatchAttempt<T>,
  succeeded: boolean,
): void {
  for (const key of Object.keys(attempt.revisions) as (keyof T)[]) {
    const field = ownership.fields[key];
    if (!field || field.revision !== attempt.revisions[key]) continue;
    if (succeeded) Reflect.deleteProperty(ownership.fields, key);
    else field.phase = "failed";
  }
}

export function failedOwnedPatch<T extends object>(
  ownership: PatchOwnership<T>,
): Partial<T> {
  const patch: Partial<T> = {};
  for (const key of Object.keys(ownership.fields) as (keyof T)[]) {
    const field = ownership.fields[key];
    if (field?.phase === "failed") patch[key] = field.value;
  }
  return patch;
}

export function overlayOwnedPatch<T extends object>(
  base: T,
  ownership: PatchOwnership<T>,
): T {
  const overlaid = { ...base };
  for (const key of Object.keys(ownership.fields) as (keyof T)[]) {
    const field = ownership.fields[key];
    if (field) overlaid[key] = field.value;
  }
  return overlaid;
}

export interface PersistenceStatusSnapshot {
  status: "idle" | "saving" | "saved" | "error";
  dirty: number;
  queued: number;
  inFlight: number;
  failed: number;
}

export function persistenceStatusSnapshot<T extends object>(
  ownership: PatchOwnership<T>,
  latestResultSucceeded: boolean,
): PersistenceStatusSnapshot {
  const counts = { dirty: 0, queued: 0, inFlight: 0, failed: 0 };
  for (const field of Object.values(
    ownership.fields,
  ) as OwnedPatchField<unknown>[]) {
    if (field.phase === "dirty") counts.dirty++;
    else if (field.phase === "queued") counts.queued++;
    else if (field.phase === "in-flight") counts.inFlight++;
    else counts.failed++;
  }
  const active = counts.dirty + counts.queued + counts.inFlight;
  return {
    status:
      counts.failed > 0
        ? "error"
        : active > 0
          ? "saving"
          : latestResultSucceeded
            ? "saved"
            : "idle",
    ...counts,
  };
}

export function canClearSavedStatus<T extends object>(
  timerRevision: number,
  currentRevision: number,
  ownership: PatchOwnership<T>,
  latestResultSucceeded: boolean,
): boolean {
  return (
    timerRevision === currentRevision &&
    persistenceStatusSnapshot(ownership, latestResultSucceeded).status ===
      "saved"
  );
}

/** Merge a field patch into the latest persisted snapshot to narrow cross-tab overwrite windows. */
export function mergeSettingsPatch(
  current: unknown,
  patch: SettingsPatch,
): Settings {
  const raw = (current ?? {}) as Record<string, unknown>;
  if (unsupportedLocalImage(raw.localImage) && hasBackgroundPatch(patch)) {
    throw new Error(
      "This saved image schema is unsupported. Background editing is unavailable.",
    );
  }
  const base = normalize(current);
  if (
    hasBackgroundPatch(patch) &&
    patch.backgroundRevision !== undefined &&
    patch.backgroundRevision !== base.backgroundRevision
  ) {
    throw new Error(IMAGE_CONFLICT);
  }
  // Revision-bearing localImage-only patches are filter intents, never source/fit snapshots.
  // Image import/use/remove/fit workflows construct their full tuple under the lock instead.
  if (
    patch.localImage &&
    patch.backgroundRevision !== undefined &&
    patch.background === undefined
  ) {
    if (
      base.background !== "local-image" ||
      !base.localImage.assetId ||
      patch.localImage.assetId !== base.localImage.assetId
    )
      throw new Error(IMAGE_CONFLICT);
    const selected = patch.localImage.filter;
    patch = {
      ...patch,
      localImage: {
        ...base.localImage,
        filter: selected,
        filterOverrides:
          selected === "none"
            ? base.localImage.filterOverrides
            : {
                ...base.localImage.filterOverrides,
                [selected]: patch.localImage.filterOverrides[selected] ?? {},
              },
      },
    };
  }
  const result = normalize({
    ...base,
    ...patch,
    backgroundRevision: base.backgroundRevision,
  });
  if (
    hasBackgroundPatch(patch) &&
    ["background", "backgroundOverrides", "localImage"].some(
      (key) =>
        JSON.stringify(base[key as keyof Settings]) !==
        JSON.stringify(result[key as keyof Settings]),
    )
  ) {
    if (base.backgroundRevision === Number.MAX_SAFE_INTEGER)
      throw new Error("Background revision limit reached.");
    result.backgroundRevision++;
  }
  // Preserve future documents byte-for-byte through unrelated settings writes.
  if (unsupportedLocalImage(raw.localImage))
    (result as unknown as Record<string, unknown>).localImage = raw.localImage;
  return result;
}

export interface SettingsPatchStore {
  read(): Promise<unknown>;
  write(settings: Settings): Promise<void>;
}

export type ExclusiveRunner = <T>(work: () => Promise<T>) => Promise<T>;
export const SETTINGS_WRITE_LOCK_NAME = "lightfield:settings-write:v1";

export interface SettingsWriteObserver {
  patch(patch: SettingsPatch): SettingsPatch;
  prepared(current: Settings, next: Settings): void;
  acknowledged(next: Settings): void;
  failed(next: Settings): void;
}

export function storedSettingsNeedNormalization(raw: unknown): boolean {
  if (
    raw === undefined ||
    unsupportedLocalImage((raw as Record<string, unknown> | null)?.localImage)
  )
    return false;
  return JSON.stringify(raw) !== JSON.stringify(normalize(raw));
}

export function strictImageSettings(raw: unknown): Settings {
  if (
    raw !== undefined &&
    (!raw || typeof raw !== "object" || Array.isArray(raw))
  )
    throw new Error("Saved settings are unreadable.");
  const r = (raw ?? {}) as Record<string, unknown>;
  if (unsupportedLocalImage(r.localImage))
    throw new Error(
      "This saved image schema is unsupported. Background editing is unavailable.",
    );
  if (
    r.backgroundRevision !== undefined &&
    backgroundRevision(r.backgroundRevision) !== r.backgroundRevision
  )
    throw new Error("Saved background revision is invalid.");
  return normalize(raw);
}
