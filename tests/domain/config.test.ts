import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SETTINGS,
  normalize,
  storedSettingsNeedNormalization,
} from "../../src/domain/settings/schema";
import {
  createQueuedExclusiveRunner,
  mergeWriteSettingsPatch,
  normalizeSettingsStore,
} from "../../src/services/settings-transactions";

describe("configuration control bindings", () => {
  test("new material and weather-label defaults; obsolete glass flag is stripped", async () => {
    expect(normalize(null)).toMatchObject({
      uiTone: "auto",
      glassBlur: 28,
      showWeatherLocation: false,
      fonts: "system",
    });
    for (const glassUi of [true, false]) {
      let stored: unknown = {
        ...DEFAULT_SETTINGS,
        theme: "ivory",
        fonts: "serif",
        weatherLocation: "London",
        glassUi,
      };
      expect(storedSettingsNeedNormalization(stored)).toBe(true);
      const next = await normalizeSettingsStore(
        {
          read: () => Promise.resolve(stored),
          write: (value) => {
            return Promise.resolve().then(() => {
              stored = value;
            });
          },
        },
        createQueuedExclusiveRunner(),
      );
      expect(stored).toEqual(next);
      expect(next).not.toHaveProperty("glassUi");
      expect(next).toEqual({
        ...DEFAULT_SETTINGS,
        theme: "ivory",
        fonts: "serif",
        weatherLocation: "London",
      });
      expect(storedSettingsNeedNormalization(stored)).toBe(false);
    }
  });
  test("material enums, finite numeric blur bounds/steps and strict weather booleans", () => {
    for (const uiTone of ["auto", "dark", "light"] as const)
      expect(normalize({ uiTone }).uiTone).toBe(uiTone);
    for (const value of [null, 1, "true", {}, []]) {
      expect(normalize({ uiTone: value }).uiTone).toBe("auto");
      expect(
        normalize({ showWeatherLocation: value }).showWeatherLocation,
      ).toBe(false);
      expect(normalize({ dateExpanded: value }).dateExpanded).toBe(false);
    }
    expect(normalize({ dateExpanded: true }).dateExpanded).toBe(true);
    for (const value of [NaN, Infinity, -Infinity, "20", null, {}])
      expect(normalize({ glassBlur: value }).glassBlur).toBe(28);
    for (const [input, result] of [
      [0, 8],
      [7, 8],
      [8, 8],
      [9, 10],
      [27.3, 28],
      [28, 28],
      [43, 44],
      [44, 44],
      [100, 44],
    ] as const) {
      expect(normalize({ glassBlur: input }).glassBlur).toBe(result);
    }
    expect(
      normalize({ showWeatherLocation: true, showWeather: false }),
    ).toMatchObject({ showWeatherLocation: true, showWeather: false });
  });
  test("patches persist and normalize external values without resetting unrelated preferences", async () => {
    let stored = normalize({ theme: "moss", fonts: "mono", weatherUnits: "f" });
    const store = {
      read: () => Promise.resolve(stored),
      write: (next: typeof stored) => {
        return Promise.resolve().then(() => {
          stored = next;
        });
      },
    };
    const runner = createQueuedExclusiveRunner();
    await mergeWriteSettingsPatch(
      store,
      { uiTone: "light", glassBlur: 36, showWeatherLocation: true },
      runner,
    );
    expect(normalize(await store.read())).toMatchObject({
      theme: "moss",
      fonts: "mono",
      weatherUnits: "f",
      uiTone: "light",
      glassBlur: 36,
      showWeatherLocation: true,
    });
    await mergeWriteSettingsPatch(
      store,
      { showWeather: false, fonts: "grotesque" },
      runner,
    );
    expect(stored).toMatchObject({
      showWeather: false,
      showWeatherLocation: true,
      uiTone: "light",
      glassBlur: 36,
    });
  });
});
