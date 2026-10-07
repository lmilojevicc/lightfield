import { requiredValue } from "../runtime/required-value";
import type { ThemePalette } from "../runtime/contracts";
import type { PixelPerfectId } from "../../shared/pixel-perfect-metadata";

export interface PixelPerfectColors {
  paper: string;
  foreground: string;
  currencyTiers: readonly string[];
}

function blend(
  from: ThemePalette["paper"],
  to: ThemePalette["ink"],
  weight: number,
): string {
  return `#${from
    .map((channel, index) =>
      Math.round(
        (channel + (requiredValue(to[index]) - channel) * weight) * 255,
      )
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** Semantic roles preserve mark hierarchy on both light and dark paper, without tinting geometry. */
export function resolvePixelPerfectColors(
  id: PixelPerfectId,
  palette: ThemePalette,
): PixelPerfectColors {
  return {
    paper: palette.paperHex,
    foreground:
      id === "pixel-perfect-dither-wave"
        ? palette.accentHex
        : id === "pixel-perfect-dither-field"
          ? blend(palette.accent, palette.ink, 0.25)
          : palette.inkHex,
    currencyTiers: [0.1, 0.24, 0.52, 1].map((weight) =>
      blend(palette.paper, palette.ink, weight),
    ),
  };
}
