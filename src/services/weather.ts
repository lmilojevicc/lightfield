export const CACHE_KEY = "lightfield:weather";
const CACHE_MS = 5 * 60 * 1000;
export const GEOLOCATION_DECIMAL_PLACES = 2;

export interface Weather {
  location: string;
  temperature: number;
  feelsLike: number;
  code: number;
  description: string;
  humidity: number;
  wind: number;
  windDirection: number;
}

export interface WeatherCacheRecord {
  weather: Weather;
  cachedAt: number;
  location: string;
  units: "c" | "f";
  auto: boolean;
}

export interface WeatherCacheStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
}

interface OpenMeteoCurrent {
  temperature_2m: number;
  apparent_temperature: number;
  relative_humidity_2m: number;
  weather_code: number;
  wind_speed_10m: number;
  wind_direction_10m: number;
}

const CODE_DESCRIPTIONS: Record<number, string> = {
  0: "Clear",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  80: "Light showers",
  81: "Showers",
  82: "Heavy showers",
  95: "Thunderstorm",
  96: "Thunderstorm",
  99: "Thunderstorm",
};

export function normalizeWeatherLocation(value: string): string {
  return value.trim() || "auto";
}

export function coarsenCoordinate(value: number): number {
  const scale = 10 ** GEOLOCATION_DECIMAL_PLACES;
  return Math.round(value * scale) / scale;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new DOMException("The request was superseded.", "AbortError");
}

export interface WeatherEnvironment {
  fetch(input: string, init?: RequestInit): Promise<Response>;
  geolocate(): Promise<{ latitude: number; longitude: number }>;
  now(): number;
  allowed(): boolean;
  locationAllowed?(): boolean;
  storage: WeatherCacheStorage & { setItem(key: string, value: string): void };
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Weather data missing");
  return value as Record<string, unknown>;
}
function coordinate(value: unknown, limit: number): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Math.abs(value) > limit
  )
    throw new Error("Invalid weather coordinates");
  return value;
}
function validateWeatherCurrent(value: unknown): OpenMeteoCurrent {
  const current = record(value);
  const fields = [
    "temperature_2m",
    "apparent_temperature",
    "relative_humidity_2m",
    "weather_code",
    "wind_speed_10m",
    "wind_direction_10m",
  ];
  if (
    fields.some(
      (key) =>
        typeof current[key] !== "number" || !Number.isFinite(current[key]),
    )
  )
    throw new Error("Weather data missing");
  if (
    Number(current.relative_humidity_2m) < 0 ||
    Number(current.relative_humidity_2m) > 100 ||
    Number(current.wind_speed_10m) < 0 ||
    Number(current.wind_direction_10m) < 0 ||
    Number(current.wind_direction_10m) > 360 ||
    !Number.isSafeInteger(current.weather_code) ||
    Number(current.weather_code) < 0
  )
    throw new Error("Invalid weather data");
  return current as unknown as OpenMeteoCurrent;
}

async function resolveLocation(
  location: string,
  env: WeatherEnvironment,
  check: () => void,
  signal?: AbortSignal,
): Promise<{ label: string; lat: number; lon: number; auto: boolean }> {
  check();
  if (location === "auto") {
    // Browser geolocation cannot be aborted, so check ownership immediately afterward.
    const pos = await env.geolocate();
    check();
    const lat = coarsenCoordinate(coordinate(pos.latitude, 90));
    const lon = coarsenCoordinate(coordinate(pos.longitude, 180));
    return {
      label: `${lat.toFixed(GEOLOCATION_DECIMAL_PLACES)}°, ${lon.toFixed(GEOLOCATION_DECIMAL_PLACES)}°`,
      lat,
      lon,
      auto: true,
    };
  }

  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
  const res = await env.fetch(url, {
    ...(signal ? { signal } : {}),
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
  });
  check();
  if (!res.ok) throw new Error("Geocoding failed");
  const json = record(await res.json());
  check();
  const hit = Array.isArray(json.results)
    ? (json.results[0] as unknown)
    : undefined;
  if (!hit) throw new Error("Location not found");
  const locationHit = record(hit);
  if (
    typeof locationHit.name !== "string" ||
    !locationHit.name.trim() ||
    (locationHit.country !== undefined &&
      typeof locationHit.country !== "string")
  )
    throw new Error("Invalid geocoding data");
  const label = locationHit.country
    ? `${locationHit.name}, ${locationHit.country}`
    : locationHit.name;
  return {
    label,
    lat: coordinate(locationHit.latitude, 90),
    lon: coordinate(locationHit.longitude, 180),
    auto: false,
  };
}

export async function fetchWeather(
  locationValue: string,
  units: "c" | "f",
  signal: AbortSignal | undefined,
  env: WeatherEnvironment,
): Promise<Weather> {
  const location = normalizeWeatherLocation(locationValue);
  const check = () => {
    throwIfAborted(signal);
    if (!env.allowed()) throw new Error("Weather requires opt-in.");
    if (location === "auto" && env.locationAllowed?.() === false)
      throw new Error("Enable location access or enter a city.");
  };
  check();
  const now = env.now();
  const cached = readWeatherCache(location, units, now, env.storage);
  if (cached) {
    check();
    return cached.weather;
  }

  const { label, lat, lon, auto } = await resolveLocation(
    location,
    env,
    check,
    signal,
  );
  check();
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${String(lat)}&longitude=${String(lon)}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m&timezone=auto`;
  const res = await env.fetch(url, {
    ...(signal ? { signal } : {}),
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
  });
  check();
  if (!res.ok) throw new Error("Weather fetch failed");
  const json = record(await res.json());
  check(); // Body parsing can finish after revocation or an aborted fetch.
  const c = validateWeatherCurrent(json.current);

  const convert = (t: number) => (units === "f" ? (t * 9) / 5 + 32 : t);
  const weather: Weather = {
    location: label,
    temperature: Math.round(convert(c.temperature_2m)),
    feelsLike: Math.round(convert(c.apparent_temperature)),
    code: c.weather_code,
    description: CODE_DESCRIPTIONS[c.weather_code] ?? "Unknown",
    humidity: Math.round(c.relative_humidity_2m),
    wind: Math.round(c.wind_speed_10m),
    windDirection: Math.round(c.wind_direction_10m),
  };

  check();
  try {
    env.storage.setItem(
      CACHE_KEY,
      JSON.stringify({
        weather,
        cachedAt: now,
        location,
        units,
        auto,
      } satisfies WeatherCacheRecord),
    );
  } catch {
    // Cache is best-effort.
  }
  check();
  return weather;
}

function validWeather(value: unknown): value is Weather {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const weather = value as Record<string, unknown>;
  return (
    typeof weather.location === "string" &&
    typeof weather.description === "string" &&
    [
      "temperature",
      "feelsLike",
      "code",
      "humidity",
      "wind",
      "windDirection",
    ].every(
      (key) =>
        typeof weather[key] === "number" && Number.isFinite(weather[key]),
    )
  );
}

export function normalizeWeatherCacheRecord(
  value: unknown,
  now: number,
): WeatherCacheRecord | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Number.isFinite(now)
  )
    return null;
  const cached = value as Record<string, unknown>;
  if (
    typeof cached.cachedAt !== "number" ||
    !Number.isFinite(cached.cachedAt) ||
    cached.cachedAt > now ||
    now - cached.cachedAt >= CACHE_MS ||
    typeof cached.location !== "string" ||
    (cached.units !== "c" && cached.units !== "f") ||
    typeof cached.auto !== "boolean" ||
    !validWeather(cached.weather)
  )
    return null;
  return cached as unknown as WeatherCacheRecord;
}

export function readWeatherCache(
  location: string,
  units: "c" | "f",
  now: number,
  storage: WeatherCacheStorage,
): WeatherCacheRecord | null {
  try {
    const raw = storage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = normalizeWeatherCacheRecord(JSON.parse(raw) as unknown, now);
    if (!parsed) {
      storage.removeItem(CACHE_KEY);
      return null;
    }
    return parsed.location === location && parsed.units === units
      ? parsed
      : null;
  } catch {
    try {
      storage.removeItem(CACHE_KEY);
    } catch {
      /* Best effort. */
    }
    return null;
  }
}

export function clearWeatherCache(storage: WeatherCacheStorage): void {
  try {
    storage.removeItem(CACHE_KEY);
  } catch {
    // Best effort.
  }
}
