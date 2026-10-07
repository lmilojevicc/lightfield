import type { Settings } from "../../domain/settings/schema";
import type { ThemePalette } from "../../shared/theme";
import { customThemeSemanticTokens } from "../../domain/themes/custom-themes";
import { requiredValue } from "../../domain/required-value";

/** Explicit material tone remains independent from the background theme. */
export function uiMaterialState(
  settings: Pick<Settings, "uiTone" | "glassBlur">,
  lightTheme: boolean,
) {
  return {
    tone:
      settings.uiTone === "auto"
        ? lightTheme
          ? "light"
          : "dark"
        : settings.uiTone,
    blur: `${String(settings.glassBlur)}px`,
  };
}

/** Source affordance contrast also applies when a light theme uses a dark controller. */
export function surfaceAccentTokens(
  tone: "light" | "dark",
  accent: readonly number[],
) {
  const paper = tone === "light" ? "#ffffff" : "#0f121c";
  const ink = tone === "light" ? "#0f172a" : "#f0f4f8";
  const hex = `#${accent
    .map((channel) =>
      Math.round(Math.max(0, Math.min(1, channel)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
  const semantic = requiredValue(customThemeSemanticTokens(paper, ink, hex));
  return {
    focus: semantic.focus,
    text: semantic.accentText,
    boundary: semantic.accentBoundary,
    ink: semantic.accentInk,
  };
}

/** Integration calls after native applyTheme, including a transient theme preview. */
export function applyUiMaterial(
  root: HTMLElement,
  settings: Pick<Settings, "uiTone" | "glassBlur">,
  palette: ThemePalette,
): void {
  const material = uiMaterialState(settings, palette.lightTheme);
  for (const [key, value] of Object.entries(
    surfaceAccentTokens(material.tone, palette.accent),
  ))
    root.style.setProperty(`--surface-accent-${key}`, value);
  root.dataset.uiTone = settings.uiTone;
  root.dataset.uiToneResolved = material.tone;
  root.classList.toggle("tone-light", material.tone === "light");
  root.style.setProperty("--glass-blur", material.blur);
}
