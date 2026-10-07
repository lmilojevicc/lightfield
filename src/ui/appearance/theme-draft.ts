import type { CustomTheme } from "../../shared/theme";
import {
  customThemeSemanticTokens,
  hexContrastRatio,
  normalizeCustomTheme,
} from "../../domain/themes/custom-themes";

export function themeDraft(theme: CustomTheme): CustomTheme | null {
  return normalizeCustomTheme({
    ...theme,
    name: theme.name.trim() || "Preview",
  });
}

export function themeSpecimenStyle(theme: CustomTheme): string {
  const tokens = customThemeSemanticTokens(
    theme.paper,
    theme.ink,
    theme.accent,
  );
  if (!tokens) return "";
  return Object.entries({
    "--color-paper": theme.paper,
    "--color-paper-2": tokens.paper2,
    "--color-ink": theme.ink,
    "--color-ink-2": tokens.ink2,
    "--color-muted": tokens.muted,
    "--color-accent": theme.accent,
    "--color-accent-ink": tokens.accentInk,
    "--color-accent-text": tokens.accentText,
    "--color-accent-boundary": tokens.accentBoundary,
    "--color-focus": tokens.focus,
  })
    .map(([key, value]) => `${key}:${value}`)
    .join(";");
}

export function customThemeSwatches(theme: CustomTheme): string[] {
  const mix = (shift: number) => {
    const ink = (parseInt(theme.ink.slice(1), 16) >> shift) & 255;
    const paper = (parseInt(theme.paper.slice(1), 16) >> shift) & 255;
    return Math.round(ink + (paper - ink) * 0.72)
      .toString(16)
      .padStart(2, "0");
  };
  return [
    theme.paper,
    theme.ink,
    `#${mix(16)}${mix(8)}${mix(0)}`,
    theme.accent,
  ];
}

export function themeTone(paper: string): string {
  return hexContrastRatio(paper, "#000000") > hexContrastRatio(paper, "#ffffff")
    ? "Light"
    : "Dark";
}
