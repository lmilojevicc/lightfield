import type { Settings } from "../domain/settings/schema";
import { normalizeWeatherLocation, type Weather } from "./weather";

export type WeatherChipSettings = Pick<
  Settings,
  "showWeather" | "showWeatherLocation" | "weatherLocation" | "weatherUnits"
>;
export interface WeatherChipView {
  hidden: boolean;
  temperature: string;
  code: number | null;
  description: string;
  location: string;
  title: string;
  accessibleName: string;
}
export function weatherChipView(
  settings: WeatherChipSettings,
  weather: Weather | null,
  failed = false,
): WeatherChipView {
  const auto = normalizeWeatherLocation(settings.weatherLocation) === "auto";
  const location = weather
    ? auto
      ? "Current location"
      : weather.location
    : "";
  const description = !settings.showWeather
    ? "Weather disabled"
    : (weather?.description ??
      (failed
        ? "Weather unavailable"
        : auto
          ? "Locating weather"
          : "Loading weather"));
  const temperature =
    settings.showWeather && weather ? `${String(weather.temperature)}°` : "--°";
  const accessibleName =
    settings.showWeather && weather
      ? `Current weather in ${location}: ${temperature}, ${description}`
      : description;
  return {
    hidden: !settings.showWeather,
    temperature,
    code: settings.showWeather && weather ? weather.code : null,
    description,
    location:
      settings.showWeather && settings.showWeatherLocation ? location : "",
    title: accessibleName,
    accessibleName,
  };
}
const requestKey = (settings: WeatherChipSettings) =>
  JSON.stringify([
    normalizeWeatherLocation(settings.weatherLocation),
    settings.weatherUnits,
  ]);

/** Retains only a successful result owned by the current location/unit request. */
export class WeatherChipController {
  private requestId = 0;
  private abort: AbortController | null = null;
  private retained: { weather: Weather; key: string } | null = null;
  constructor(
    private readonly deps: {
      settings(): WeatherChipSettings;
      isActive(): boolean;
      fetch(
        location: string,
        units: "c" | "f",
        signal: AbortSignal,
      ): Promise<Weather>;
      clearCache(): void;
      render(view: WeatherChipView): void;
    },
  ) {}

  suspend(): void {
    this.abort?.abort();
    this.abort = null;
    ++this.requestId;
  }
  reset(): void {
    this.suspend();
    this.retained = null;
    this.deps.render(weatherChipView(this.deps.settings(), null));
  }
  renderRetained(): void {
    const settings = this.deps.settings();
    if (
      !settings.showWeather ||
      (this.retained && this.retained.key !== requestKey(settings))
    ) {
      this.reset();
      return;
    }
    if (this.retained && this.deps.isActive())
      this.deps.render(weatherChipView(settings, this.retained.weather));
  }
  async refresh(): Promise<void> {
    this.reset();
    const settings = this.deps.settings();
    if (!settings.showWeather) {
      this.deps.clearCache();
      return;
    }
    if (!this.deps.isActive()) return;
    const id = this.requestId;
    const key = requestKey(settings);
    const abort = new AbortController();
    this.abort = abort;
    const ownsRequest = () =>
      id === this.requestId &&
      this.deps.isActive() &&
      this.deps.settings().showWeather &&
      requestKey(this.deps.settings()) === key;
    try {
      const weather = await this.deps.fetch(
        normalizeWeatherLocation(settings.weatherLocation),
        settings.weatherUnits,
        abort.signal,
      );
      if (!ownsRequest()) return;
      this.retained = { weather, key };
      this.renderRetained();
    } catch (error) {
      if (
        !ownsRequest() ||
        (error instanceof DOMException && error.name === "AbortError")
      )
        return;
      this.retained = null;
      this.deps.render(weatherChipView(this.deps.settings(), null, true));
    } finally {
      if (id === this.requestId) this.abort = null;
    }
  }
}
