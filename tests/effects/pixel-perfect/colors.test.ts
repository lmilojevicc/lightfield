import { requiredValue } from "../../../src/effects/runtime/required-value";
import { describe, expect, test } from "bun:test";
import type { ThemePalette } from "../../../src/effects/runtime/contracts";
import { resolvePixelPerfectColors } from "../../../src/effects/pixel-perfect/colors";
import { PIXEL_PERFECT_IDS } from "../../../src/shared/pixel-perfect-metadata";

const channels = (hex: string): [number, number, number] =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
function testPalette(
  paperHex = "#101020",
  inkHex = "#b0c0d0",
  accentHex = "#e04080",
  lightTheme = false,
): ThemePalette {
  return {
    paperHex,
    paper: channels(paperHex),
    inkHex,
    ink: channels(inkHex),
    accentHex,
    accent: channels(accentHex),
    focusHex: "#20ff10",
    focus: channels("#20ff10"),
    lightTheme,
  };
}

describe("Pixel Perfect semantic colors", () => {
  for (const palette of [
    testPalette(),
    testPalette("#f0f0f0", "#303030", "#804020", true),
    testPalette("#777777", "#787878", "#777777"),
  ]) {
    test(`all six roles and ordered tiers on ${palette.paperHex}`, () => {
      for (const id of PIXEL_PERFECT_IDS) {
        const colors = resolvePixelPerfectColors(id, palette);
        expect(colors.paper).toBe(palette.paperHex);
        if (id === "pixel-perfect-dither-wave")
          expect(colors.foreground).toBe(palette.accentHex);
        else if (id === "pixel-perfect-dither-field") {
          channels(colors.foreground).forEach((value, i) => {
            expect(value).toBeCloseTo(
              requiredValue(palette.accent[i]) * 0.75 +
                requiredValue(palette.ink[i]) * 0.25,
              2,
            );
          });
        } else expect(colors.foreground).toBe(palette.inkHex);
        expect(colors.currencyTiers).toHaveLength(4);
        expect(colors.currencyTiers[3]).toBe(palette.inkHex);
        colors.currencyTiers.forEach((color, tier) => {
          expect(color).toMatch(/^#[0-9a-f]{6}$/);
          channels(color).forEach((value, i) => {
            expect(Number.isFinite(value)).toBe(true);
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(1);
            expect(value).toBeCloseTo(
              requiredValue(palette.paper[i]) +
                (requiredValue(palette.ink[i]) -
                  requiredValue(palette.paper[i])) *
                  requiredValue([0.1, 0.24, 0.52, 1][tier]),
              2,
            );
            const previous = requiredValue(
              channels(
                tier
                  ? requiredValue(colors.currencyTiers[tier - 1])
                  : colors.paper,
              )[i],
            );
            expect(
              Math.abs(value - requiredValue(palette.paper[i])),
            ).toBeGreaterThanOrEqual(
              Math.abs(previous - requiredValue(palette.paper[i])),
            );
          });
        });
        expect(
          resolvePixelPerfectColors(id, {
            ...palette,
            focusHex: "#ffffff",
            focus: [1, 1, 1],
            lightTheme: !palette.lightTheme,
          }),
        ).toEqual(colors);
      }
    });
  }
});
