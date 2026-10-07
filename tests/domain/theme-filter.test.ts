import { describe, expect, test } from "bun:test";
import { BUILTIN_THEME_IDS as THEMES } from "../../src/shared/theme";
import { themeMatchesSearch } from "../../src/domain/themes/theme-filter";

describe("theme-filter without collapse state", () => {
  test("an empty query matches all 36 shipped themes and custom names", () => {
    expect(THEMES).toHaveLength(36);
    for (const id of [...THEMES, "custom:sample"])
      expect(themeMatchesSearch("", id, id)).toBe(true);
  });
  test("names/IDs match independent of accents, spacing and case", () => {
    expect(themeMatchesSearch("rose pine", "Rosé Pine", "rosepine")).toBe(true);
    expect(
      themeMatchesSearch("custom:sample", "My theme", "custom:sample"),
    ).toBe(true);
    expect(
      themeMatchesSearch("LATTE", "Catppuccin Latte", "catppuccin-latte"),
    ).toBe(true);
    expect(themeMatchesSearch("missing", "Midnight", "midnight")).toBe(false);
  });
});
