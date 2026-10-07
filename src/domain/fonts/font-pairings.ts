import { requiredValue } from "../required-value";
/** One role contract for the live app and typography specimens. No network presets. */
export interface FontFamily {
  name: string;
  source: "included" | "system" | "google";
  stack: string;
  weights: readonly number[];
  /** Selected role weights, verified against decoded remote face descriptors. */
  baseWeight?: number;
  emphasisWeight?: number;
}
const included = (
  name: string,
  fallback: string,
  weights: readonly number[],
): FontFamily => ({
  name,
  source: "included",
  stack: `${JSON.stringify(name)}, ${fallback}`,
  weights,
});
// Fraunces keeps its registry entry (and shipped subset) for dormant custom pairings, not as a preset.
export const FONT_FAMILIES: readonly FontFamily[] = [
  included("Instrument Serif", "Georgia, serif", [400]),
  included("Bricolage Grotesque", "system-ui, sans-serif", [400, 600]),
  included("Fraunces", "Georgia, serif", [400, 600]),
  included("JetBrains Mono", "ui-monospace, monospace", [400, 600]),
  {
    name: "system-ui",
    source: "system",
    stack:
      '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro", "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
    weights: [400, 500, 600],
  },
  {
    name: "Georgia",
    source: "system",
    stack: "Georgia, serif",
    weights: [400, 600],
  },
  {
    name: "Arial",
    source: "system",
    stack: "Arial, sans-serif",
    weights: [400, 600],
  },
];
export const GOOGLE_FONT_SUGGESTIONS = [
  "Cormorant Garamond",
  "Inter",
  "Lora",
  "DM Sans",
] as const;
// Preserve historical display/body mappings; cards describe the actual families.
export const FONT_PRESETS = [
  {
    id: "system",
    label: "System Sans",
    badge: "Default",
    displayWeight: 500,
    display: requiredValue(FONT_FAMILIES[4]),
    body: requiredValue(FONT_FAMILIES[4]),
  },
  {
    id: "grotesque",
    label: "Clear Sans",
    badge: "Modern",
    displayWeight: 600,
    display: requiredValue(FONT_FAMILIES[1]),
    body: requiredValue(FONT_FAMILIES[1]),
  },
  {
    id: "mono",
    label: "Technical Mono",
    badge: "Code",
    displayWeight: 600,
    display: requiredValue(FONT_FAMILIES[3]),
    body: requiredValue(FONT_FAMILIES[3]),
  },
  // Historical serif means Instrument in BOTH roles. Never silently remap its body.
  {
    id: "serif",
    label: "Classic Serif",
    badge: "Classic",
    displayWeight: 400,
    display: requiredValue(FONT_FAMILIES[0]),
    body: requiredValue(FONT_FAMILIES[0]),
  },
] as const;
export type FontPresetId = (typeof FONT_PRESETS)[number]["id"];
/** Retired presets keep their serif character instead of snapping back to the default. */
export const RETIRED_FONT_PRESETS: Readonly<Record<string, FontPresetId>> = {
  editorial: "serif",
  fraunces: "serif",
};
export type FontPairing = FontPresetId | "custom";
export function isFontPairing(value: unknown): value is FontPairing {
  return (
    value === "custom" || FONT_PRESETS.some((preset) => preset.id === value)
  );
}
export function fontPreset(id: FontPresetId) {
  return requiredValue(FONT_PRESETS.find((preset) => preset.id === id));
}
export type FontRole = "display" | "body";
export function validateFontFamily(raw: string): string {
  // Reject, rather than rewrite, CSS stacks, escapes, URLs, and controls.
  if (raw.length > 60 || /[\p{Cc}\p{Cf}]/u.test(raw))
    throw new Error("Use one family name, up to 60 characters.");
  const name = raw.trim().replace(/ +/g, " ");
  if (!name || !/^[\p{L}\p{N}][\p{L}\p{M}\p{N} .&()’'_-]*$/u.test(name)) {
    throw new Error("Enter a family name, not a URL or CSS font list.");
  }
  return name;
}
export function resolveFontFamily(raw: string, role: FontRole): FontFamily {
  const name = validateFontFamily(raw);
  return (
    FONT_FAMILIES.find(
      (font) => font.name.toLowerCase() === name.toLowerCase(),
    ) ?? {
      name,
      source: "google",
      stack: `${JSON.stringify(name)}, ${role === "display" ? "Georgia, serif" : "system-ui, sans-serif"}`,
      weights: role === "display" ? [400] : [400, 600],
    }
  );
}
export function fontRoleTokens(
  display: FontFamily,
  body: FontFamily,
  displayWeight = display.baseWeight ?? 400,
): Record<string, string> {
  return {
    "--font-display": display.stack,
    "--font-body": body.stack,
    "--font-display-weight": String(
      display.weights.includes(displayWeight)
        ? displayWeight
        : (display.baseWeight ?? display.weights[0] ?? 400),
    ),
    "--font-body-weight": String(body.baseWeight ?? 400),
    "--font-body-emphasis": String(
      body.emphasisWeight ??
        (body.weights.includes(600) ? 600 : (body.baseWeight ?? 400)),
    ),
  };
}
export function customFontTuple(display: string, body: string) {
  // Preserve valid saved spelling; normalization is for resolution, not migration.
  validateFontFamily(display);
  validateFontFamily(body);
  return {
    fonts: "custom" as const,
    customDisplayFont: display,
    customBodyFont: body,
  };
}
