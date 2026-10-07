import { expect, test } from "bun:test";
import {
  uiMaterialState,
  surfaceAccentTokens,
} from "../../../src/ui/shell/material";
import { hexContrastRatio } from "../../../src/domain/themes/custom-themes";
test("auto follows palette luminance but explicit UI tone remains independent", () => {
  expect(uiMaterialState({ uiTone: "auto", glassBlur: 28 }, true)).toEqual({
    tone: "light",
    blur: "28px",
  });
  expect(uiMaterialState({ uiTone: "dark", glassBlur: 0 }, true)).toEqual({
    tone: "dark",
    blur: "0px",
  });
  expect(uiMaterialState({ uiTone: "light", glassBlur: 16 }, false)).toEqual({
    tone: "light",
    blur: "16px",
  });
});
test("cyan affordances remain readable on the independently selected material", () => {
  for (const tone of ["dark", "light"] as const) {
    const tokens = surfaceAccentTokens(tone, [0, 0.75, 0.9]);
    expect(
      hexContrastRatio(tokens.focus, tone === "light" ? "#ffffff" : "#0f121c"),
    ).toBeGreaterThanOrEqual(3);
  }
});
