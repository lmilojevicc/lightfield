import { requiredValue } from "../../src/effects/runtime/required-value";
import { describe, expect, test } from "bun:test";
import {
  BACKGROUND_IDS,
  BACKGROUND_IMPLEMENTATION_IDS,
  BACKGROUND_REGISTRY,
  LIGHTFIELD_COLLECTION,
} from "../../src/shared/background-metadata";
import { backgroundLoaders } from "../../src/effects/runtime/loaders";
import { lerp } from "../../src/effects/meridian-quad";
import {
  ISLAND_THEME_PALETTES,
  resolveShaderPalette,
  hexToRgb,
} from "../../src/shared/theme";
import type { ThemePalette } from "../../src/effects/runtime/contracts";

describe("Island demo shader ports & palette transitions", () => {
  test("clemta is completely dropped from background catalog and loaders", () => {
    expect((BACKGROUND_IDS as readonly string[]).includes("clemta")).toBe(
      false,
    );
    expect(
      (BACKGROUND_IMPLEMENTATION_IDS as readonly string[]).includes("clemta"),
    ).toBe(false);
    expect(
      (LIGHTFIELD_COLLECTION.ids as readonly string[]).includes("clemta"),
    ).toBe(false);
    expect(
      (backgroundLoaders as Record<string, unknown>)["clemta"],
    ).toBeUndefined();
    expect(
      BACKGROUND_REGISTRY.find((item) => (item.id as string) === "clemta"),
    ).toBeUndefined();
  });

  test("ink, dither-sky, and julia are registered in catalog under LIGHTFIELD_COLLECTION", () => {
    for (const id of ["ink", "dither-sky", "julia"] as const) {
      expect(LIGHTFIELD_COLLECTION.ids).toContain(id);
      expect(BACKGROUND_IDS).toContain(id);
      expect(BACKGROUND_IMPLEMENTATION_IDS).toContain(id);

      const descriptor = BACKGROUND_REGISTRY.find((item) => item.id === id);
      expect(descriptor).toBeDefined();
      expect(descriptor?.available).toBe(true);
      expect(descriptor?.controls.length).toBeGreaterThan(0);
      expect(backgroundLoaders[id]).toBeDefined();
    }
  });

  test("descriptors have expected display names", () => {
    expect(BACKGROUND_REGISTRY.find((item) => item.id === "ink")?.name).toBe(
      "Ink",
    );
    expect(
      BACKGROUND_REGISTRY.find((item) => item.id === "dither-sky")?.name,
    ).toBe("Dither Sky");
    expect(BACKGROUND_REGISTRY.find((item) => item.id === "julia")?.name).toBe(
      "Julia",
    );
  });

  test("4-stop asymptotic exponential lerp formula (0.05 per frame) matches app.js", () => {
    const currentPal = [
      [0, 0, 0],
      [0.2, 0.2, 0.2],
      [0.4, 0.4, 0.4],
      [0.6, 0.6, 0.6],
    ];
    const targetPal = [
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
    ];

    // Single frame lerp test
    for (let i = 0; i < 4; i++) {
      requiredValue(currentPal[i])[0] = lerp(
        requiredValue(requiredValue(currentPal[i])[0]),
        requiredValue(requiredValue(targetPal[i])[0]),
        0.05,
      );
      requiredValue(currentPal[i])[1] = lerp(
        requiredValue(requiredValue(currentPal[i])[1]),
        requiredValue(requiredValue(targetPal[i])[1]),
        0.05,
      );
      requiredValue(currentPal[i])[2] = lerp(
        requiredValue(requiredValue(currentPal[i])[2]),
        requiredValue(requiredValue(targetPal[i])[2]),
        0.05,
      );
    }

    expect(requiredValue(currentPal[0])[0]).toBeCloseTo(0.05, 5);
    expect(requiredValue(currentPal[1])[0]).toBeCloseTo(
      0.2 + (1 - 0.2) * 0.05,
      5,
    ); // 0.24
    expect(requiredValue(currentPal[2])[0]).toBeCloseTo(
      0.4 + (1 - 0.4) * 0.05,
      5,
    ); // 0.43
    expect(requiredValue(currentPal[3])[0]).toBeCloseTo(
      0.6 + (1 - 0.6) * 0.05,
      5,
    ); // 0.62

    // Simulate 60 frames (1 second at 60fps)
    for (let frame = 1; frame < 60; frame++) {
      for (let i = 0; i < 4; i++) {
        requiredValue(currentPal[i])[0] = lerp(
          requiredValue(requiredValue(currentPal[i])[0]),
          requiredValue(requiredValue(targetPal[i])[0]),
          0.05,
        );
        requiredValue(currentPal[i])[1] = lerp(
          requiredValue(requiredValue(currentPal[i])[1]),
          requiredValue(requiredValue(targetPal[i])[1]),
          0.05,
        );
        requiredValue(currentPal[i])[2] = lerp(
          requiredValue(requiredValue(currentPal[i])[2]),
          requiredValue(requiredValue(targetPal[i])[2]),
          0.05,
        );
      }
    }

    // After 60 frames of factor 0.05: (1 - 0.05)^60 ≈ 0.0460697
    // Remaining distance is ~4.6% of initial distance
    const expectedRemaining = Math.pow(0.95, 60);
    expect(1 - requiredValue(requiredValue(currentPal[0])[0])).toBeCloseTo(
      1 * expectedRemaining,
      4,
    );
    expect(1 - requiredValue(requiredValue(currentPal[1])[0])).toBeCloseTo(
      0.8 * expectedRemaining,
      4,
    );
    expect(1 - requiredValue(requiredValue(currentPal[2])[0])).toBeCloseTo(
      0.6 * expectedRemaining,
      4,
    );
    expect(1 - requiredValue(requiredValue(currentPal[3])[0])).toBeCloseTo(
      0.4 * expectedRemaining,
      4,
    );
  });

  test("resolveShaderPalette maps known Island themes to their 4-stop shader palettes", () => {
    const mockPalette: ThemePalette = {
      paper: [0, 0, 0],
      paperHex: "#000000",
      ink: [1, 1, 1],
      inkHex: "#ffffff",
      accent: [0.22, 0.74, 0.97],
      accentHex: "#38bdf8",
      focus: [0.5, 0.5, 0.5],
      focusHex: "#808080",
      lightTheme: false,
    };

    // Explicit shaderPalette provided
    const explicitPalette: ThemePalette = {
      ...mockPalette,
      shaderPalette: [
        [0.1, 0.1, 0.1],
        [0.2, 0.2, 0.2],
        [0.3, 0.3, 0.3],
        [0.4, 0.4, 0.4],
      ],
    };
    expect(resolveShaderPalette(explicitPalette)).toEqual(
      requiredValue(explicitPalette.shaderPalette),
    );

    // Fallback derivation from paper and accent
    const derived = resolveShaderPalette(mockPalette);
    expect(derived[0]).toEqual(mockPalette.paper);
    expect(derived[3]).toEqual(mockPalette.accent);
    expect(derived[1][0]).toBeCloseTo(
      mockPalette.paper[0] +
        (mockPalette.accent[0] - mockPalette.paper[0]) * 0.3,
    );
    expect(derived[2][0]).toBeCloseTo(
      mockPalette.paper[0] +
        (mockPalette.accent[0] - mockPalette.paper[0]) * 0.7,
    );

    // Island theme midnight match
    const midnight = requiredValue(ISLAND_THEME_PALETTES["midnight"]);
    expect(midnight).toBeDefined();
    expect(midnight.map(hexToRgb)).toEqual([
      hexToRgb("#04050b"),
      hexToRgb("#141a3d"),
      hexToRgb("#4a3a86"),
      hexToRgb("#38bdf8"),
    ]);
  });

  test("ISLAND_THEME_PALETTES includes curated 4-stop shader palettes for all 36 shipped themes plus aliases", () => {
    const shippedThemes = [
      "midnight",
      "ivory",
      "slate",
      "moss",
      "catppuccin-latte",
      "catppuccin-frappe",
      "catppuccin-macchiato",
      "catppuccin-mocha",
      "gruvbox",
      "tokyonight",
      "rosepine",
      "rosepine-dawn",
      "nord",
      "solarized-dark",
      "kanagawa",
      "kanagawa-dragon",
      "kanagawa-lotus",
      "everforest",
      "everforest-light",
      "night-owl",
      "night-owl-light",
      "github-dark",
      "onedark",
      "ayu-mirage",
      "ayu-dark",
      "ayu-light",
      "dracula",
      "monokai",
      "monokai-dimmed",
      "solarized-light",
      "gruvbox-light",
      "nord-light",
      "tokyonight-storm",
      "tokyonight-moon",
      "rosepine-moon",
      "monochrome",
    ];
    const hexPattern = /^#[0-9a-fA-F]{6}$/;

    for (const theme of shippedThemes) {
      const palette = ISLAND_THEME_PALETTES[theme];
      expect(palette).toBeDefined();
      expect(palette?.length).toBe(4);
      for (const stop of requiredValue(palette)) {
        expect(hexPattern.test(stop)).toBe(true);
      }
      // Ensure all 4 stops are distinct
      const uniqueStops = new Set(palette);
      expect(uniqueStops.size).toBe(4);
    }

    // Alias test
    expect(ISLAND_THEME_PALETTES["rose-pine"]).toEqual(
      ISLAND_THEME_PALETTES["rosepine"],
    );
  });

  test("palette lerp glides smoothly across dark-to-dark, light-to-light, and dark-to-light transitions", () => {
    const testTransitions: [string, string][] = [
      ["midnight", "nord"], // dark-to-dark
      ["ivory", "rosepine-dawn"], // light-to-light
      ["midnight", "ivory"], // dark-to-light
      ["catppuccin-latte", "catppuccin-mocha"], // light-to-dark
    ];

    for (const [from, to] of testTransitions) {
      const fromStops = requiredValue(ISLAND_THEME_PALETTES[from]).map(
        hexToRgb,
      );
      const toStops = requiredValue(ISLAND_THEME_PALETTES[to]).map(hexToRgb);
      const cur = fromStops.map((stop) => [...stop]);

      for (let frame = 0; frame < 60; frame++) {
        for (let i = 0; i < 4; i++) {
          for (let ch = 0; ch < 3; ch++) {
            requiredValue(cur[i])[ch] = lerp(
              requiredValue(requiredValue(cur[i])[ch]),
              requiredValue(requiredValue(toStops[i])[ch]),
              0.05,
            );
            expect(Number.isFinite(requiredValue(cur[i])[ch])).toBe(true);
            expect(
              requiredValue(requiredValue(cur[i])[ch]),
            ).toBeGreaterThanOrEqual(0);
            expect(
              requiredValue(requiredValue(cur[i])[ch]),
            ).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });
});
