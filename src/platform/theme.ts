import { requiredValue } from "../domain/required-value";
import {
  hexToRgb,
  resolveShaderPalette,
  type ThemePalette,
  type CustomTheme,
} from "../shared/theme";
import {
  normalizeCustomTheme,
  customThemeSemanticTokens,
} from "../domain/themes/custom-themes";
function cssColorToRgb(
  value: string,
  fallback: string,
  context: CanvasRenderingContext2D | null,
): [number, number, number] {
  if (!context) return hexToRgb(fallback);
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = fallback;
  context.fillStyle = value.trim();
  context.fillRect(0, 0, 1, 1);
  const color = context.getImageData(0, 0, 1, 1).data;
  return [
    requiredValue(color[0]) / 255,
    requiredValue(color[1]) / 255,
    requiredValue(color[2]) / 255,
  ];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb
    .map((channel) =>
      Math.round(channel * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function relativeLuminance01(hex: string): number {
  const channel = (index: number) => {
    const srgb = parseInt(hex.slice(index, index + 2), 16) / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** Editor seeds use primary text ink; shader palettes deliberately use secondary ink. */
export function readThemeColors(
  root: HTMLElement,
): Pick<CustomTheme, "paper" | "ink" | "accent"> {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const style = getComputedStyle(root);
  return {
    paper: toHex(
      cssColorToRgb(
        style.getPropertyValue("--color-paper"),
        "#11111b",
        context,
      ),
    ),
    ink: toHex(
      cssColorToRgb(style.getPropertyValue("--color-ink"), "#f0f4f8", context),
    ),
    accent: toHex(
      cssColorToRgb(
        style.getPropertyValue("--color-accent"),
        "#74c7ec",
        context,
      ),
    ),
  };
}

export function readThemePalette(root: HTMLElement): ThemePalette {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const style = getComputedStyle(root);
  const paper = cssColorToRgb(
    style.getPropertyValue("--color-paper"),
    "#11111b",
    context,
  );
  const ink = cssColorToRgb(
    style.getPropertyValue("--color-ink-2"),
    "#bac2de",
    context,
  );
  const accent = cssColorToRgb(
    style.getPropertyValue("--color-accent"),
    "#74c7ec",
    context,
  );
  const focus = cssColorToRgb(
    style.getPropertyValue("--color-focus"),
    "#89dceb",
    context,
  );
  const paperHex = toHex(paper);
  const theme =
    root.dataset.theme || root.getAttribute("data-theme") || undefined;
  const palette: ThemePalette = {
    paper,
    paperHex,
    ink,
    inkHex: toHex(ink),
    accent,
    accentHex: toHex(accent),
    focus,
    focusHex: toHex(focus),
    lightTheme: relativeLuminance01(paperHex) > 0.5,
  };
  palette.shaderPalette = resolveShaderPalette(palette, undefined, theme);
  return palette;
}

const TOKENS = [
  "paper",
  "paper-2",
  "paper-3",
  "ink",
  "ink-2",
  "muted",
  "rule",
  "rule-2",
  "accent",
  "accent-ink",
  "accent-text",
  "accent-boundary",
  "control",
  "focus",
  "scrim",
];
function mixHex(a: string, b: string, strength: number): string {
  const left = parseInt(a.slice(1), 16),
    right = parseInt(b.slice(1), 16);
  return (
    "#" +
    [16, 8, 0]
      .map((shift) =>
        Math.round(
          ((left >> shift) & 255) * (1 - strength) +
            ((right >> shift) & 255) * strength,
        )
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
export function applyTheme(
  root: HTMLElement,
  selected: string,
  themes: readonly CustomTheme[],
): ThemePalette {
  root.dataset.theme = selected;
  for (const token of TOKENS) root.style.removeProperty(`--color-${token}`);
  root.style.removeProperty("color-scheme");
  const theme = normalizeCustomTheme(
    themes.find((value) => value.id === selected),
  );
  if (theme) {
    const semantic = customThemeSemanticTokens(
      theme.paper,
      theme.ink,
      theme.accent,
    );
    if (!semantic) throw new Error("Invalid custom theme.");
    const values = [
      theme.paper,
      semantic.paper2,
      mixHex(theme.paper, "#ffffff", 0.1),
      theme.ink,
      semantic.ink2,
      semantic.muted,
      mixHex(theme.ink, theme.paper, 0.72),
      mixHex(theme.ink, theme.paper, 0.82),
      theme.accent,
      semantic.accentInk,
      semantic.accentText,
      semantic.accentBoundary,
      semantic.control,
      semantic.focus,
      mixHex(theme.paper, "#000000", 0.45),
    ];
    TOKENS.forEach((token, index) => {
      root.style.setProperty(`--color-${token}`, values[index] ?? "");
    });
    const paper = parseInt(theme.paper.slice(1), 16);
    const hint =
      ((paper >> 16) & 255) * 0.2126 +
      ((paper >> 8) & 255) * 0.7152 +
      (paper & 255) * 0.0722;
    root.style.colorScheme = hint > 140 ? "light" : "dark";
  }
  return readThemePalette(root);
}
