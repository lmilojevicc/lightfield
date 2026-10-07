import { requiredValue } from "../../src/domain/required-value";
import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS } from "../../src/domain/settings/schema";
import {
  WeatherChipController,
  weatherChipView,
  type WeatherChipView,
} from "../../src/services/weather-chip";
import type { Weather } from "../../src/services/weather";

const weather: Weather = {
  location: "London, United Kingdom",
  temperature: 14,
  feelsLike: 12,
  code: 3,
  description: "Overcast",
  humidity: 50,
  wind: 3,
  windDirection: 0,
};
function setup() {
  let settings = {
    ...DEFAULT_SETTINGS,
    showWeather: true,
    weatherLocation: "London",
  };
  let active = true;
  const views: WeatherChipView[] = [];
  const requests: {
    location: string;
    units: string;
    signal: AbortSignal;
    resolve(value: Weather): void;
    reject(error: Error): void;
  }[] = [];
  let clears = 0;
  const controller = new WeatherChipController({
    settings: () => settings,
    isActive: () => active,
    fetch: (location, units, signal) =>
      new Promise((resolve, reject) =>
        requests.push({ location, units, signal, resolve, reject }),
      ),
    clearCache: () => {
      clears++;
    },
    render: (view) => views.push(view),
  });
  return {
    controller,
    views,
    requests,
    settings,
    update: (patch: Partial<typeof settings>) => {
      settings = { ...settings, ...patch };
    },
    activity: (value: boolean) => {
      active = value;
    },
    clears: () => clears,
  };
}
describe("weather-chip retained results and request ownership", () => {
  test("manual resolved name is opt-in; repeated label toggles do not fetch", async () => {
    const h = setup();
    const work = h.controller.refresh();
    expect(h.views.at(-1)?.location).toBe("");
    requiredValue(h.requests[0]).resolve(weather);
    await work;
    expect(h.views.at(-1)).toMatchObject({
      temperature: "14°",
      location: "",
      title: "Current weather in London, United Kingdom: 14°, Overcast",
    });
    h.update({ showWeatherLocation: true });
    h.controller.renderRetained();
    expect(h.views.at(-1)?.location).toBe(weather.location);
    h.update({ showWeatherLocation: false });
    h.controller.renderRetained();
    expect(h.views.at(-1)?.location).toBe("");
    expect(h.requests).toHaveLength(1);
  });
  test("auto never renders provider coordinates, even in title/accessibility name", async () => {
    const h = setup();
    h.update({ weatherLocation: "auto", showWeatherLocation: true });
    const work = h.controller.refresh();
    requiredValue(h.requests[0]).resolve({
      ...weather,
      location: "51.50, -0.12",
    });
    await work;
    const view = requiredValue(h.views.at(-1));
    expect(view.location).toBe("Current location");
    expect(view.title).toContain("Current location");
    expect(view.accessibleName).toContain("Current location");
    expect(JSON.stringify(view)).not.toContain("51.50");
  });
  test("location/unit change clears immediately, aborts old request and ignores late success", async () => {
    const h = setup();
    h.update({ showWeatherLocation: true });
    const first = h.controller.refresh();
    requiredValue(h.requests[0]).resolve(weather);
    await first;
    const old = h.controller.refresh();
    expect(h.views.at(-1)?.location).toBe("");
    h.update({ weatherLocation: "Tokyo", weatherUnits: "f" });
    h.controller.reset();
    expect(requiredValue(h.requests[1]).signal.aborted).toBe(true);
    const current = h.controller.refresh();
    requiredValue(h.requests[1]).resolve(weather);
    await old;
    expect(h.views.at(-1)?.location).toBe("");
    expect(h.requests[2]).toMatchObject({ location: "Tokyo", units: "f" });
    requiredValue(h.requests[2]).resolve({
      ...weather,
      location: "Tokyo, Japan",
      temperature: 70,
    });
    await current;
    expect(h.views.at(-1)).toMatchObject({
      location: "Tokyo, Japan",
      temperature: "70°",
    });
  });
  test("loading/error/disabled clear stale labels and accessible descriptions", async () => {
    const h = setup();
    h.update({ showWeatherLocation: true });
    const first = h.controller.refresh();
    requiredValue(h.requests[0]).resolve(weather);
    await first;
    const failing = h.controller.refresh();
    expect(h.views.at(-1)).toMatchObject({
      location: "",
      accessibleName: "Loading weather",
      code: null,
    });
    requiredValue(h.requests[1]).reject(Error("offline"));
    await failing;
    expect(h.views.at(-1)).toMatchObject({
      location: "",
      title: "Weather unavailable",
      temperature: "--°",
    });
    h.controller.renderRetained(); // A label toggle cannot revive the discarded result.
    expect(h.views.at(-1)?.location).toBe("");
    h.update({ showWeather: false });
    await h.controller.refresh();
    expect(h.views.at(-1)).toMatchObject({
      hidden: true,
      location: "",
      accessibleName: "Weather disabled",
    });
    expect(h.clears()).toBe(1);
    expect(h.requests).toHaveLength(2);
  });
  test("suspension prevents publication and inactive refresh cannot fetch", async () => {
    const h = setup();
    const work = h.controller.refresh();
    h.activity(false);
    h.controller.suspend();
    expect(requiredValue(h.requests[0]).signal.aborted).toBe(true);
    requiredValue(h.requests[0]).resolve(weather);
    await work;
    expect(h.views.at(-1)?.temperature).toBe("--°");
    await h.controller.refresh();
    expect(h.requests).toHaveLength(1);
    h.activity(true);
    const resumed = h.controller.refresh();
    requiredValue(h.requests[1]).resolve(weather);
    await resumed;
    expect(h.views.at(-1)?.temperature).toBe("14°");
  });
  test("latest display preference wins during fetch; full long name survives for truncation", async () => {
    const h = setup();
    const work = h.controller.refresh();
    h.update({ showWeatherLocation: true });
    h.controller.renderRetained();
    const location = "A very long resolved city and country ".repeat(8);
    requiredValue(h.requests[0]).resolve({ ...weather, location });
    await work;
    expect(h.views.at(-1)?.location).toBe(location);
    expect(h.views.at(-1)?.title).toContain(location);
    expect(h.views.at(-1)?.accessibleName).toContain(location);
    expect(
      weatherChipView(
        { ...h.settings, weatherLocation: "", showWeatherLocation: true },
        weather,
      ).location,
    ).toBe("Current location");
  });
  test("unannounced location changes and disabling cannot publish an obsolete response", async () => {
    for (const patch of [
      { weatherLocation: "Paris" },
      { showWeather: false },
    ]) {
      const h = setup();
      const work = h.controller.refresh();
      h.update(patch);
      requiredValue(h.requests[0]).resolve(weather);
      await work;
      expect(h.views.at(-1)?.temperature).toBe("--°");
    }
  });
});
