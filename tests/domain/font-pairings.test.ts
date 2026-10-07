import { expectRejected } from "../platform/rejection";
/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
  FONT_PRESETS,
  RETIRED_FONT_PRESETS,
  customFontTuple,
  fontPreset,
  fontRoleTokens,
  resolveFontFamily,
  validateFontFamily,
} from "../../src/domain/fonts/font-pairings";
import { DEFAULT_SETTINGS, normalize } from "../../src/domain/settings/schema";
import { mergeWriteSettingsPatch } from "../../src/services/settings-transactions";

describe("font-pairings registry and compatibility", () => {
  test("new tabs start with Ink and clean system sans in both roles", () => {
    const settings = normalize(null);
    expect(DEFAULT_SETTINGS.background).toBe("ink");
    expect(settings.background).toBe("ink");
    expect(DEFAULT_SETTINGS.fonts).toBe("system");
    expect(settings.fonts).toBe("system");
    const preset = fontPreset("system");
    const stack =
      '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro", "Segoe UI", Roboto, "Helvetica Neue", sans-serif';
    expect(preset.display.stack).toBe(stack);
    expect(preset.body.stack).toBe(stack);
    expect(preset.display.source).toBe("system");
    expect(preset.body.source).toBe("system");
    expect(normalize({ background: "none", fonts: "grotesque" })).toMatchObject(
      { background: "none", fonts: "grotesque" },
    );
    // Retired presets migrate to the classic serif instead of snapping back to the system default.
    expect(RETIRED_FONT_PRESETS).toEqual({
      editorial: "serif",
      fraunces: "serif",
    });
    for (const retired of Object.keys(RETIRED_FONT_PRESETS)) {
      expect(FONT_PRESETS.some((preset) => preset.id === retired)).toBe(false);
      expect(normalize({ ...DEFAULT_SETTINGS, fonts: retired }).fonts).toBe(
        "serif",
      );
    }
    // Only own keys migrate: prototype members must fall back to the default, never become the value.
    for (const inherited of [
      "toString",
      "constructor",
      "valueOf",
      "hasOwnProperty",
    ]) {
      expect(normalize({ ...DEFAULT_SETTINGS, fonts: inherited }).fonts).toBe(
        "system",
      );
      expect(
        typeof normalize({ ...DEFAULT_SETTINGS, fonts: inherited }).fonts,
      ).toBe("string");
    }
  });
  test("historical IDs and dormant custom strings survive normalization", () => {
    for (const id of [...FONT_PRESETS.map((p) => p.id), "custom"] as const) {
      const settings = normalize({
        ...DEFAULT_SETTINGS,
        fonts: id,
        customDisplayFont: "Unavailable Old Name",
        customBodyFont: "Historical Body",
      });
      expect(settings.fonts).toBe(id);
      expect(settings.customDisplayFont).toBe("Unavailable Old Name");
      expect(settings.customBodyFont).toBe("Historical Body");
    }
    expect(fontPreset("serif").body.name).toBe("Instrument Serif");
    expect(fontPreset("grotesque").body.name).toBe("Bricolage Grotesque");
    expect(fontPreset("mono").display.name).toBe("JetBrains Mono");
    expect(fontPreset("mono").body.name).toBe("JetBrains Mono");
    expect(fontPreset("mono").display.source).toBe("included");
  });
  test("runtime and specimens use exact same role contract and honest emphasis", () => {
    for (const preset of FONT_PRESETS) {
      const tokens = fontRoleTokens(
        preset.display,
        preset.body,
        preset.displayWeight,
      );
      expect(tokens["--font-display"]).toBe(preset.display.stack);
      expect(tokens["--font-body"]).toBe(preset.body.stack);
      expect(preset.display.weights).toContain(preset.displayWeight);
      expect(tokens["--font-display-weight"]).toBe(
        String(preset.displayWeight),
      );
      expect(Object.keys(tokens)).not.toContain("--color-paper");
      expect(Object.keys(tokens)).not.toContain("--opening-rail-tint");
      expect(Object.keys(tokens)).not.toContain("--clock-digit-width");
      expect(tokens["--font-body-emphasis"]).toBe(
        preset.id === "serif" ? "400" : "600",
      );
    }
    const non400 = {
      ...resolveFontFamily("Betania Patmos", "body"),
      weights: [500, 700],
      baseWeight: 500,
      emphasisWeight: 700,
    };
    expect(fontRoleTokens(non400, non400)).toMatchObject({
      "--font-display-weight": "500",
      "--font-body-weight": "500",
      "--font-body-emphasis": "700",
    });
    const regularOnly = { ...non400, weights: [500], emphasisWeight: 500 };
    expect(
      fontRoleTokens(regularOnly, regularOnly)["--font-body-emphasis"],
    ).toBe("500");
    const instrument = resolveFontFamily("Instrument Serif", "display");
    expect(
      fontRoleTokens(instrument, instrument, 600)["--font-display-weight"],
    ).toBe("400");
  });
  test("family validation rejects injection without rewriting safe historical names", () => {
    for (const invalid of [
      "",
      "  ",
      "A;B",
      "url(https://test)",
      "A,B",
      'A"B',
      "A\\B",
      "A{B}",
      "A\nB",
      "A\tB",
      "a".repeat(61),
      "A\u202eB",
    ])
      expect(() => validateFontFamily(invalid)).toThrow();
    expect(validateFontFamily("  José’s  Font 2 ")).toBe("José’s Font 2");
    expect(resolveFontFamily("bricolage grotesque", "body").source).toBe(
      "included",
    );
    expect(resolveFontFamily("Instrument Serif", "body").weights).toEqual([
      400,
    ]);
    expect(resolveFontFamily("Unknown Historical Font", "display").source).toBe(
      "google",
    );
    expect(
      customFontTuple(" Instrument Serif ", "Inter").customDisplayFont,
    ).toBe(" Instrument Serif ");
  });
  test("atomic typography patch preserves unrelated theme/material and dormant names", async () => {
    let stored = normalize({
      ...DEFAULT_SETTINGS,
      theme: "ivory",
      showWeatherLocation: true,
    });
    const writes: unknown[] = [];
    const store = {
      read: () => Promise.resolve(stored),
      write: (next: typeof stored) => {
        return Promise.resolve().then(() => {
          writes.push(next);
          stored = next;
        });
      },
    };
    await mergeWriteSettingsPatch(
      store,
      customFontTuple("Fraunces", "Bricolage Grotesque"),
      async (operation) => operation(),
    );
    expect(writes).toHaveLength(1);
    expect(stored).toMatchObject({
      theme: "ivory",
      showWeatherLocation: true,
      fonts: "custom",
      customDisplayFont: "Fraunces",
      customBodyFont: "Bricolage Grotesque",
    });
    await mergeWriteSettingsPatch(
      store,
      { fonts: "system" },
      async (operation) => operation(),
    );
    expect(stored.customDisplayFont).toBe("Fraunces");
    await mergeWriteSettingsPatch(
      store,
      { theme: "midnight" },
      async (operation) => operation(),
    );
    expect(stored.fonts).toBe("system");
    const before = stored;
    await expectRejected(
      mergeWriteSettingsPatch(
        {
          read: () => Promise.resolve(stored),
          write: () => {
            return Promise.resolve().then(() => {
              throw Error("Storage unavailable");
            });
          },
        },
        customFontTuple("Instrument Serif", "Inter"),
        async (operation) => operation(),
      ),
    );
    expect(stored).toBe(before);
  });
});
