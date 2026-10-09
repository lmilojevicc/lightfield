import { describe, expect, test } from "bun:test";
import {
  themeDraft,
  themeSpecimenStyle,
  customThemeSwatches,
} from "../../../src/ui/appearance/theme-draft";
import {
  THEME_CARDS,
  themeMatchesSearch,
} from "../../../src/ui/appearance/theme-cards";
import { BUILTIN_THEME_IDS } from "../../../src/shared/theme";
const selected = {
  id: "custom:one",
  name: "One",
  paper: "#0b0f19",
  ink: "#f0f4f8",
  accent: "#38bdf8",
};

describe("appearance draft interaction", () => {
  test("local specimen draft validates hex without mutating saved colors", () => {
    const draft = themeDraft({ ...selected, name: "", accent: "#ff8800" });
    expect(draft?.name).toBe("Preview");
    expect(themeDraft({ ...selected, paper: "#bad" })).toBeNull();
    expect(selected.accent).toBe("#38bdf8");
  });
  test("derived specimen and swatches use real theme values without mutating draft", () => {
    const original = { ...selected };
    expect(themeSpecimenStyle(selected)).toContain("--color-paper:#0b0f19");
    expect(themeSpecimenStyle(selected)).toContain("--color-accent-ink:");
    expect(customThemeSwatches(selected)).toEqual([
      "#0b0f19",
      "#f0f4f8",
      "#4b4f57",
      "#38bdf8",
    ]);
    expect(selected).toEqual(original);
  });
  test("family-grouped source cards filter names, IDs, accents and separators", () => {
    expect(new Set(THEME_CARDS.map((card) => card.id))).toEqual(
      new Set(BUILTIN_THEME_IDS),
    );
    expect(THEME_CARDS.slice(0, 3).map((card) => card.name)).toEqual([
      "Midnight",
      "Monochrome",
      "Ivory",
    ]);
    expect(themeMatchesSearch("ROSE PINE", "Rosé Pine", "rosepine")).toBe(true);
    expect(
      themeMatchesSearch(
        "catppuccin frappe",
        "Catppuccin Frappé",
        "catppuccin-frappe",
      ),
    ).toBe(true);
    expect(themeMatchesSearch("unknown", "Midnight", "midnight")).toBe(false);
  });
});
