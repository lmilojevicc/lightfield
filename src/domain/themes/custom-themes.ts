import { requiredValue } from "../required-value";
import type {
  CustomTheme,
  CustomThemeContrastWarning,
  CustomThemeImportResult,
  CustomThemeSemanticTokens,
} from "../../shared/theme";
export const CUSTOM_THEME_EXPORT_SCHEMA = "lightfield.custom-themes";
export const CUSTOM_THEME_EXPORT_VERSION = 1;
export const CUSTOM_THEME_IMPORT_MAX_BYTES = 256 * 1024;
export const CUSTOM_THEME_IMPORT_MAX_COUNT = 100;
export const CUSTOM_THEME_ID_PATTERN = /^custom:[A-Za-z0-9_-]+$/;

// WCAG 2.x AA minimum for the normal-sized semantic text tokens.
export const CUSTOM_THEME_MIN_CONTRAST = 4.5;
export const CUSTOM_THEME_MIN_BOUNDARY_CONTRAST = 3;

export function canonicalHexColor(value: unknown): string | null {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : null;
}

function relativeLuminance(hex: string): number {
  const channel = (index: number) => {
    const srgb = parseInt(hex.slice(index, index + 2), 16) / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function hexContrastRatio(a: string, b: string): number {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

export function customThemeAccentInk(
  paperValue: unknown,
  inkValue: unknown,
  accentValue: unknown,
): string | null {
  const paper = canonicalHexColor(paperValue);
  const ink = canonicalHexColor(inkValue);
  const accent = canonicalHexColor(accentValue);
  if (!paper || !ink || !accent) return null;
  const candidates = [paper, ink, "#000000", "#ffffff"]
    .map((color) => ({ color, contrast: hexContrastRatio(color, accent) }))
    .filter(({ contrast }) => contrast >= CUSTOM_THEME_MIN_CONTRAST)
    .sort((a, b) => b.contrast - a.contrast);
  return candidates[0]?.color ?? null;
}

export function customThemePaper2(paperValue: unknown): string | null {
  const paper = canonicalHexColor(paperValue);
  return paper ? mixHexSrgb(paper, "#ffffff", 0.05) : null;
}

function mixHexSrgb(a: string, b: string, bStrength: number): string {
  const left = parseInt(a.slice(1), 16);
  const right = parseInt(b.slice(1), 16);
  const channel = (shift: number) => {
    const from = (left >> shift) & 0xff;
    const to = (right >> shift) & 0xff;
    return Math.round(from + (to - from) * bStrength)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

/** Keep an intended sRGB ink→paper mix when readable on both page and settings surfaces. */
export function customThemeReadableTextColor(
  paperValue: unknown,
  inkValue: unknown,
  intendedPaperStrength: number,
): string | null {
  const paper = canonicalHexColor(paperValue);
  const paper2 = customThemePaper2(paperValue);
  const ink = canonicalHexColor(inkValue);
  if (!paper || !paper2 || !ink || !Number.isFinite(intendedPaperStrength))
    return null;
  const strength = Math.min(1, Math.max(0, intendedPaperStrength));

  // Enumerate every rounded-sRGB transition. Testing transition points and the
  // constant-color intervals between them finds the closest compliant result
  // without assuming luminance is monotonic for mixed-direction RGB channels.
  const points = new Set<number>([0, strength]);
  const left = parseInt(ink.slice(1), 16);
  const right = parseInt(paper.slice(1), 16);
  for (const shift of [16, 8, 0]) {
    const from = (left >> shift) & 0xff;
    const to = (right >> shift) & 0xff;
    const delta = to - from;
    if (delta === 0) continue;
    for (let roundedBoundary = 0.5; roundedBoundary < 255; roundedBoundary++) {
      const point = (roundedBoundary - from) / delta;
      if (point > 0 && point < strength) points.add(point);
    }
  }
  const ordered = [...points].sort((a, b) => b - a);
  const candidates: number[] = [];
  for (let index = 0; index < ordered.length; index++) {
    const point = requiredValue(ordered[index]);
    candidates.push(point);
    const next = ordered[index + 1];
    if (next !== undefined) candidates.push((point + next) / 2);
  }
  const seen = new Set<string>();
  for (const point of candidates) {
    const color = mixHexSrgb(ink, paper, point);
    if (seen.has(color)) continue;
    seen.add(color);
    if (
      hexContrastRatio(color, paper) >= CUSTOM_THEME_MIN_CONTRAST &&
      hexContrastRatio(color, paper2) >= CUSTOM_THEME_MIN_CONTRAST
    )
      return color;
  }
  return null;
}

function customThemeReadableAccentRole(
  paper: string,
  paper2: string,
  ink: string,
  accent: string,
  minimum: number,
): string | null {
  for (let step = 0; step <= 1000; step++) {
    const candidate = mixHexSrgb(accent, ink, step / 1000);
    if (
      hexContrastRatio(candidate, paper) >= minimum &&
      hexContrastRatio(candidate, paper2) >= minimum
    )
      return candidate;
  }
  return null;
}

export function customThemeTextTokens(
  paperValue: unknown,
  inkValue: unknown,
): { ink2: string; muted: string } | null {
  const ink2 = customThemeReadableTextColor(paperValue, inkValue, 0.3);
  const muted = customThemeReadableTextColor(paperValue, inkValue, 0.45);
  return ink2 && muted ? { ink2, muted } : null;
}

function highestMinimumContrast(
  candidates: readonly string[],
  backgrounds: readonly string[],
): string {
  return requiredValue(
    [...candidates]
      .map((color) => ({
        color,
        contrast: Math.min(
          ...backgrounds.map((background) =>
            hexContrastRatio(color, background),
          ),
        ),
      }))
      .sort((a, b) => b.contrast - a.contrast)[0],
  ).color;
}

export function customThemeSemanticTokens(
  paperValue: unknown,
  inkValue: unknown,
  accentValue: unknown,
): CustomThemeSemanticTokens | null {
  const paper = canonicalHexColor(paperValue);
  const paper2 = customThemePaper2(paperValue);
  const ink = canonicalHexColor(inkValue);
  const accent = canonicalHexColor(accentValue);
  if (!paper || !paper2 || !ink || !accent) return null;

  const text = customThemeTextTokens(paper, ink) ?? {
    ink2: mixHexSrgb(ink, paper, 0.3),
    muted: mixHexSrgb(ink, paper, 0.45),
  };
  const accentInk =
    customThemeAccentInk(paper, ink, accent) ??
    highestMinimumContrast([paper, ink, "#000000", "#ffffff"], [accent]);
  const accentText =
    customThemeReadableAccentRole(
      paper,
      paper2,
      ink,
      accent,
      CUSTOM_THEME_MIN_CONTRAST,
    ) ??
    highestMinimumContrast(
      [accent, ink, "#000000", "#ffffff"],
      [paper, paper2],
    );
  const accentBoundary =
    customThemeReadableAccentRole(
      paper,
      paper2,
      ink,
      accent,
      CUSTOM_THEME_MIN_BOUNDARY_CONTRAST,
    ) ??
    highestMinimumContrast(
      [accent, ink, "#000000", "#ffffff"],
      [paper, paper2],
    );
  return {
    paper2,
    ink2: text.ink2,
    muted: text.muted,
    accentInk,
    accentText,
    accentBoundary,
    control: text.muted,
    focus: accentBoundary,
  };
}

function contrastEvaluation(
  foreground: string,
  background: string,
  label: string,
  minimum: number,
): CustomThemeContrastWarning {
  return {
    foreground,
    background,
    label,
    ratio: hexContrastRatio(foreground, background),
    minimum,
  };
}

export function customThemeContrastFails(
  ratio: number,
  minimum: number,
): boolean {
  return ratio < minimum;
}

/** All evaluated semantic pairs, including passing pairs, for warnings and table-driven checks. */
export function evaluateCustomThemeContrast(
  theme: CustomTheme,
): CustomThemeContrastWarning[] {
  const semantic = customThemeSemanticTokens(
    theme.paper,
    theme.ink,
    theme.accent,
  );
  if (!semantic) return [];
  return [
    contrastEvaluation(
      theme.ink,
      theme.paper,
      "Primary text on page",
      CUSTOM_THEME_MIN_CONTRAST,
    ),
    contrastEvaluation(
      theme.ink,
      semantic.paper2,
      "Primary text on settings surface",
      CUSTOM_THEME_MIN_CONTRAST,
    ),
    contrastEvaluation(
      semantic.ink2,
      theme.paper,
      "Secondary text on page",
      CUSTOM_THEME_MIN_CONTRAST,
    ),
    contrastEvaluation(
      semantic.ink2,
      semantic.paper2,
      "Secondary text on settings surface",
      CUSTOM_THEME_MIN_CONTRAST,
    ),
    contrastEvaluation(
      semantic.muted,
      theme.paper,
      "Muted text on page",
      CUSTOM_THEME_MIN_CONTRAST,
    ),
    contrastEvaluation(
      semantic.muted,
      semantic.paper2,
      "Muted text on settings surface",
      CUSTOM_THEME_MIN_CONTRAST,
    ),
    contrastEvaluation(
      semantic.accentInk,
      theme.accent,
      "Button text on accent",
      CUSTOM_THEME_MIN_CONTRAST,
    ),
    contrastEvaluation(
      semantic.accentText,
      theme.paper,
      "Accent text on page",
      CUSTOM_THEME_MIN_CONTRAST,
    ),
    contrastEvaluation(
      semantic.accentText,
      semantic.paper2,
      "Accent text on settings surface",
      CUSTOM_THEME_MIN_CONTRAST,
    ),
    contrastEvaluation(
      semantic.focus,
      theme.paper,
      "Focus ring on page",
      CUSTOM_THEME_MIN_BOUNDARY_CONTRAST,
    ),
    contrastEvaluation(
      semantic.focus,
      semantic.paper2,
      "Focus ring on settings surface",
      CUSTOM_THEME_MIN_BOUNDARY_CONTRAST,
    ),
    contrastEvaluation(
      semantic.accentBoundary,
      theme.paper,
      "Selected boundary on page",
      CUSTOM_THEME_MIN_BOUNDARY_CONTRAST,
    ),
    contrastEvaluation(
      semantic.accentBoundary,
      semantic.paper2,
      "Selected boundary on settings surface",
      CUSTOM_THEME_MIN_BOUNDARY_CONTRAST,
    ),
    contrastEvaluation(
      semantic.control,
      semantic.paper2,
      "Control boundary on settings surface",
      CUSTOM_THEME_MIN_BOUNDARY_CONTRAST,
    ),
  ];
}

export function analyzeCustomThemeContrast(
  theme: CustomTheme,
): CustomThemeContrastWarning[] {
  return evaluateCustomThemeContrast(theme).filter(({ ratio, minimum }) =>
    customThemeContrastFails(ratio, minimum),
  );
}

export function normalizeCustomTheme(value: unknown): CustomTheme | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const theme = value as Record<string, unknown>;
  if (
    typeof theme.id !== "string" ||
    theme.id.length > 64 ||
    !CUSTOM_THEME_ID_PATTERN.test(theme.id) ||
    typeof theme.name !== "string"
  )
    return null;
  const name = theme.name.trim();
  if (name.length < 1 || name.length > 40) return null;
  const paper = canonicalHexColor(theme.paper);
  const ink = canonicalHexColor(theme.ink);
  const accent = canonicalHexColor(theme.accent);
  if (!paper || !ink || !accent) return null;
  return { id: theme.id, name, paper, ink, accent };
}

export const CUSTOM_THEMES_KEY = "lightfield:custom-themes";

function normalizeCustomThemeList(themes: readonly unknown[]): CustomTheme[] {
  const valid: CustomTheme[] = [];
  const ids = new Set<string>();
  for (const value of themes) {
    const theme = normalizeCustomTheme(value);
    if (!theme || ids.has(theme.id)) continue;
    ids.add(theme.id);
    valid.push(theme);
    if (valid.length === CUSTOM_THEME_IMPORT_MAX_COUNT) break;
  }
  return valid;
}

export function parseStoredCustomThemes(raw: string | null): CustomTheme[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? normalizeCustomThemeList(parsed) : [];
  } catch {
    return [];
  }
}

export function validateCustomThemes(
  themes: readonly CustomTheme[],
): CustomTheme[] {
  const normalized = themes.map(normalizeCustomTheme);
  if (normalized.some((theme) => theme === null))
    throw new Error("A custom theme is invalid.");
  const valid = normalized.filter(
    (theme): theme is CustomTheme => theme !== null,
  );
  if (valid.length > CUSTOM_THEME_IMPORT_MAX_COUNT)
    throw new Error("At most 100 custom themes can be saved.");
  if (new Set(valid.map((theme) => theme.id)).size !== valid.length)
    throw new Error("Custom theme IDs must be unique.");
  return valid;
}

export function createCustomThemeId(randomUUID: () => string): string {
  return `custom:${randomUUID()}`;
}

export function createUniqueCustomThemeId(
  usedIds: Iterable<string>,
  randomUUID: () => string,
): string {
  const used = new Set(usedIds);
  for (let attempt = 0; attempt < 1_000; attempt++) {
    const id = createCustomThemeId(randomUUID);
    if (!used.has(id)) return id;
  }
  throw new Error("Could not generate a unique custom-theme ID.");
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const allowedKeys = new Set(allowed);
  return (
    Object.keys(value).every((key) => allowedKeys.has(key)) &&
    allowed.every((key) => key in value)
  );
}

function importError(message: string): never {
  throw new Error(`Import failed: ${message} Nothing was changed.`);
}

export function serializeCustomThemeExport(
  themes: readonly CustomTheme[],
): string {
  const valid = themes.map(normalizeCustomTheme);
  if (valid.some((theme) => theme === null))
    throw new Error("Cannot export invalid custom themes.");
  return JSON.stringify(
    {
      schema: CUSTOM_THEME_EXPORT_SCHEMA,
      version: CUSTOM_THEME_EXPORT_VERSION,
      themes: valid,
    },
    null,
    2,
  );
}

export function parseCustomThemeExport(
  raw: string,
  existingThemes: readonly CustomTheme[],
  randomUUID: () => string,
): CustomThemeImportResult {
  if (new TextEncoder().encode(raw).byteLength > CUSTOM_THEME_IMPORT_MAX_BYTES)
    importError("the file is larger than 256 KiB.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return importError("the file is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    importError("the root must be an object.");
  const root = parsed as Record<string, unknown>;
  if (!hasOnlyKeys(root, ["schema", "version", "themes"]))
    importError("the file contains unsupported fields.");
  if (
    root.schema !== CUSTOM_THEME_EXPORT_SCHEMA &&
    root.schema !== "meridian.custom-themes"
  )
    importError("the schema is not supported.");
  if (root.version !== CUSTOM_THEME_EXPORT_VERSION)
    importError(`unsupported version ${String(root.version)}.`);
  if (!Array.isArray(root.themes)) importError("themes must be an array.");
  if (root.themes.length > CUSTOM_THEME_IMPORT_MAX_COUNT)
    importError("the file contains more than 100 themes.");
  if (
    existingThemes.length + root.themes.length >
    CUSTOM_THEME_IMPORT_MAX_COUNT
  ) {
    importError("the merged collection would contain more than 100 themes.");
  }

  const importedIds = new Set<string>();
  const imported = root.themes.map((value, index) => {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !hasOnlyKeys(value as Record<string, unknown>, [
        "id",
        "name",
        "paper",
        "ink",
        "accent",
      ])
    ) {
      return importError(
        `theme ${String(index + 1)} contains unsupported or missing fields.`,
      );
    }
    const theme = normalizeCustomTheme(value);
    if (!theme) return importError(`theme ${String(index + 1)} is invalid.`);
    if (importedIds.has(theme.id))
      return importError(`theme ${String(index + 1)} repeats ID ${theme.id}.`);
    importedIds.add(theme.id);
    return theme;
  });

  const usedIds = new Set(existingThemes.map((theme) => theme.id));
  let remappedCount = 0;
  const mergedImports = imported.map((theme) => {
    if (!usedIds.has(theme.id)) {
      usedIds.add(theme.id);
      return theme;
    }
    remappedCount++;
    let id: string;
    try {
      id = createUniqueCustomThemeId(usedIds, randomUUID);
    } catch {
      return importError("a unique ID could not be generated.");
    }
    usedIds.add(id);
    return { ...theme, id };
  });
  return {
    themes: [...existingThemes, ...mergedImports],
    importedCount: mergedImports.length,
    remappedCount,
    warningCount: mergedImports.reduce(
      (count, theme) => count + analyzeCustomThemeContrast(theme).length,
      0,
    ),
  };
}

export function duplicateCustomTheme(
  theme: CustomTheme,
  randomUUID: () => string,
  usedIds: Iterable<string> = [],
): CustomTheme {
  return {
    ...theme,
    id: createUniqueCustomThemeId(usedIds, randomUUID),
    name: `${theme.name.slice(0, 35).trimEnd()} copy`,
  };
}

export function isCustomThemeName(v: string): boolean {
  return v.startsWith("custom:");
}
