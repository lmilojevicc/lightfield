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
import {
  createCustomThemePreviewState,
  customThemePreviewTransition,
} from "../../../src/domain/themes/custom-theme-workflow";
const selected = {
  id: "custom:one",
  name: "One",
  paper: "#0b0f19",
  ink: "#f0f4f8",
  accent: "#38bdf8",
};

describe("appearance draft interaction", () => {
  test("invalid hex retains last applied draft; cancel resolves newest external selection", () => {
    const draft = themeDraft({ ...selected, name: "", accent: "#ff8800" });
    expect(draft?.name).toBe("Preview");
    if (!draft) throw new Error("Invalid fixture");
    let state = customThemePreviewTransition(
      createCustomThemePreviewState(selected),
      { type: "preview", theme: draft },
    );
    expect(themeDraft({ ...draft, paper: "#bad" })).toBeNull();
    state = customThemePreviewTransition(state, { type: "invalid-draft" });
    expect(state.applied).toBe(draft);
    const external = { ...selected, id: "custom:external", name: "External" };
    state = customThemePreviewTransition(state, {
      type: "select",
      theme: external,
    });
    state = customThemePreviewTransition(state, { type: "cancel" });
    expect(state.applied).toBe(external);
    expect(state.draft).toBeNull();
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
