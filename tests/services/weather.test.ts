import { deferred, waitUntil } from "./deferred";
import { expect, test } from "bun:test";
import {
  fetchWeather,
  readWeatherCache,
  CACHE_KEY,
  type WeatherEnvironment,
} from "../../src/services/weather";
import { expectRejected } from "../platform/rejection";
const current = {
  temperature_2m: 20.6,
  apparent_temperature: 19.4,
  relative_humidity_2m: 50.4,
  weather_code: 3,
  wind_speed_10m: 3.7,
  wind_direction_10m: 359.5,
};
function environment(payload: unknown = { current }) {
  const values = new Map<string, string>();
  const urls: string[] = [];
  const env: WeatherEnvironment = {
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
      removeItem: (key) => {
        values.delete(key);
      },
    },
    allowed: () => true,
    now: () => 1000,
    geolocate: () =>
      Promise.resolve({ latitude: 51.501234, longitude: -0.12345 }),
    fetch: (url) => {
      urls.push(url);
      return Promise.resolve(
        new Response(
          JSON.stringify(
            url.includes("/search?")
              ? {
                  results: [
                    {
                      name: "London",
                      country: "United Kingdom",
                      latitude: 51.5,
                      longitude: -0.12,
                    },
                  ],
                }
              : payload,
          ),
        ),
      );
    },
  };
  return { env, urls, values };
}
test("valid outputs and Celsius/Fahrenheit rounding exactly retain source weather semantics", async () => {
  const h = environment();
  expect(await fetchWeather(" London ", "c", undefined, h.env)).toEqual({
    location: "London, United Kingdom",
    temperature: 21,
    feelsLike: 19,
    code: 3,
    description: "Overcast",
    humidity: 50,
    wind: 4,
    windDirection: 360,
  });
  const fahrenheit = await fetchWeather("London", "f", undefined, h.env);
  expect(fahrenheit.temperature).toBe(69);
  expect(fahrenheit.feelsLike).toBe(67);
  expect(h.values.has("lightfield:weather")).toBe(true);
  expect(h.values.has("meridian:weather")).toBe(false);
  expect(readWeatherCache("London", "f", 1000, h.env.storage)?.weather).toEqual(
    fahrenheit,
  );
  expect(readWeatherCache("London", "f", 301000, h.env.storage)).toBeNull();
});
test("auto coordinates are coarse; cache hit avoids network; unknown numeric code remains Unknown", async () => {
  const h = environment({ current: { ...current, weather_code: 1000 } });
  const result = await fetchWeather("auto", "c", undefined, h.env);
  expect(result.location).toBe("51.50°, -0.12°");
  expect(result.description).toBe("Unknown");
  expect(h.urls[0]).toContain("latitude=51.5&longitude=-0.12");
  await fetchWeather("auto", "c", undefined, h.env);
  expect(h.urls).toHaveLength(1);
});
test("malformed network payloads never create cache or alter valid numeric output semantics", async () => {
  for (const payload of [
    null,
    {},
    { current: {} },
    { current: { ...current, temperature_2m: "20" } },
    { current: { ...current, wind_speed_10m: -1 } },
    { current: { ...current, relative_humidity_2m: 101 } },
    { current: { ...current, weather_code: 1.2 } },
  ]) {
    const h = environment(payload);
    await expectRejected(
      fetchWeather("auto", "c", undefined, h.env),
      /Weather|weather/,
    );
    expect(h.values.has(CACHE_KEY)).toBe(false);
  }
  const h = environment();
  h.env.fetch = () =>
    Promise.resolve(
      new Response('{"results":[{"name":"X","latitude":999,"longitude":0}]}'),
    );
  await expectRejected(fetchWeather("X", "c", undefined, h.env), "coordinates");
});
test("opt-in denial and abort after response parsing cannot publish cache", async () => {
  const h = environment();
  h.env.allowed = () => false;
  await expectRejected(fetchWeather("auto", "c", undefined, h.env), "opt-in");
  expect(h.urls).toEqual([]);
  h.env.allowed = () => true;
  const controller = new AbortController();
  h.env.fetch = () => {
    controller.abort();
    return Promise.resolve(new Response(JSON.stringify({ current })));
  };
  await expectRejected(
    fetchWeather("auto", "c", controller.signal, h.env),
    "superseded",
  );
  expect(h.values.size).toBe(0);
});
test("revoking weather during deferred geolocation starts no forecast or cache publication", async () => {
  const h = environment();
  const geo = deferred<{ latitude: number; longitude: number }>();
  let allowed = true;
  h.env.allowed = () => allowed;
  h.env.geolocate = () => geo.promise;
  const outcome = fetchWeather("auto", "c", undefined, h.env);
  allowed = false;
  geo.resolve({ latitude: 51, longitude: 0 });
  await expectRejected(outcome, "opt-in");
  expect(h.urls).toEqual([]);
  expect(h.values.size).toBe(0);
});
for (const stage of ["geocoding", "forecast"] as const)
  test(`revoking weather during deferred ${stage} body prevents subsequent requests/publication`, async () => {
    const h = environment();
    const body = deferred<unknown>();
    let allowed = true;
    let reads = 0;
    h.env.allowed = () => allowed;
    h.env.fetch = (url) => {
      h.urls.push(url);
      const response = new Response();
      response.json = () => {
        reads++;
        return body.promise;
      };
      return Promise.resolve(response);
    };
    const work = fetchWeather(
      stage === "geocoding" ? "London" : "auto",
      "c",
      undefined,
      h.env,
    );
    await waitUntil(() => reads === 1);
    allowed = false;
    body.resolve(
      stage === "geocoding"
        ? { results: [{ name: "London", latitude: 51, longitude: 0 }] }
        : { current },
    );
    await expectRejected(work, "opt-in");
    expect(h.urls).toHaveLength(1);
    expect(h.values.size).toBe(0);
  });
