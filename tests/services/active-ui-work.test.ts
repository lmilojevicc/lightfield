import { requiredValue } from "../../src/domain/required-value";
import { browserWeatherEnvironment } from "../../src/platform/browser";
/// <reference types="bun" />
import { expect, test } from "bun:test";
import {
  createActiveClock,
  type ActivitySignal,
} from "../../src/services/active-ui-work";
import { FontRequestOwner } from "../../src/services/custom-font-loading";
import { fetchWeather as fetchWeatherInjected } from "../../src/services/weather";

function activity(initial = false) {
  let active = initial;
  const listeners = new Set<(active: boolean) => void>();
  return {
    isActive: () => active,
    subscribe(listener: (active: boolean) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(value: boolean) {
      if (active === value) return;
      active = value;
      for (const listener of listeners) listener(value);
    },
  } satisfies ActivitySignal & { set(value: boolean): void };
}

test("clock has one active timer, immediate resume tick, and no inactive DOM writes", () => {
  const page = activity(false);
  const callbacks = new Map<number, () => void>();
  let next = 0,
    ticks = 0;
  const timers = {
    setInterval(callback: () => void, ms: number) {
      expect(ms).toBe(1000);
      callbacks.set(++next, callback);
      return next;
    },
    clearInterval(id: number) {
      callbacks.delete(id);
    },
  } as Parameters<typeof createActiveClock>[2];
  const clock = createActiveClock(page, () => ticks++, timers);
  clock.refresh();
  expect(ticks).toBe(0);
  expect(callbacks.size).toBe(0);
  page.set(true);
  expect(ticks).toBe(1);
  expect(callbacks.size).toBe(1);
  clock.refresh();
  expect(ticks).toBe(2);
  expect(callbacks.size).toBe(1);
  callbacks.values().next().value?.();
  expect(ticks).toBe(3);
  const stale = requiredValue(callbacks.values().next().value);
  page.set(false);
  stale();
  clock.refresh();
  expect(ticks).toBe(3);
  expect(callbacks.size).toBe(0);
  page.set(true);
  expect(ticks).toBe(4);
  expect(callbacks.size).toBe(1);
  clock.dispose();
  expect(callbacks.size).toBe(0);
});

test("weather defers, aborts fetch, rejects late geolocation and resumes latest settings", async () => {
  const page = activity(false);
  const old = { location: "auto", units: "c" as const };
  let settings: { location: string; units: "c" | "f" } = old;
  const originalNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );
  const originalStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  const originalFetch = globalThis.fetch;
  const geolocations: Array<(position: GeolocationPosition) => void> = [];
  const calls: string[] = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      geolocation: {
        getCurrentPosition(resolve: (value: GeolocationPosition) => void) {
          geolocations.push(resolve);
        },
      },
    },
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => null,
      removeItem: () => {},
      setItem: () => {},
    },
  });
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
    Promise.resolve().then(() => {
      calls.push(input instanceof Request ? input.url : String(input));
      if (init?.signal?.aborted)
        throw new DOMException("Aborted", "AbortError");
      return new Response(
        JSON.stringify({
          current: {
            temperature_2m: 20,
            apparent_temperature: 19,
            relative_humidity_2m: 50,
            weather_code: 0,
            wind_speed_10m: 1,
            wind_direction_10m: 0,
          },
        }),
        { status: 200 },
      );
    })) as typeof fetch;
  let id = 0,
    controller: AbortController | null = null;
  const displayed: string[] = [];
  const weather = createActiveEffect(
    page,
    async () => {
      controller?.abort();
      const revision = ++id;
      const current = (controller = new AbortController());
      try {
        const result = await fetchWeather(
          settings.location,
          settings.units,
          current.signal,
        );
        if (revision === id && page.isActive())
          displayed.push(`${result.location}:${String(result.temperature)}`);
      } catch {
        /* abort is expected */
      }
    },
    () => {
      controller?.abort();
      ++id;
      return true;
    },
  );
  try {
    void weather.request();
    void weather.request();
    expect(geolocations.length).toBe(0);
    page.set(true);
    expect(geolocations.length).toBe(1);
    page.set(false);
    settings = { location: "auto", units: "f" };
    void weather.request();
    page.set(true);
    expect(geolocations.length).toBe(2);
    requiredValue(geolocations[0])({
      coords: { latitude: 1, longitude: 2 },
    } as GeolocationPosition);
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual([]);
    expect(displayed).toEqual([]);
    requiredValue(geolocations[1])({
      coords: { latitude: 3, longitude: 4 },
    } as GeolocationPosition);
    for (let i = 0; i < 10 && displayed.length === 0; i++)
      await Promise.resolve();
    expect(calls.length).toBe(1);
    expect(displayed).toEqual(["3.00°, 4.00°:68"]);
  } finally {
    weather.dispose();
    globalThis.fetch = originalFetch;
    if (originalNavigator)
      Object.defineProperty(globalThis, "navigator", originalNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
    if (originalStorage)
      Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("weather aborts an in-flight geocoding fetch on inactivity and uses resumed location", async () => {
  const page = activity(false);
  let location = "Berlin",
    controller: AbortController | null = null,
    aborted = false;
  const shown: string[] = [],
    requested: string[] = [];
  const originalStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => null,
      removeItem: () => {},
      setItem: () => {},
    },
  });
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    requested.push(url);
    if (url.includes("Berlin"))
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      });
    if (url.includes("geocoding"))
      return Promise.resolve(
        new Response(
          JSON.stringify({
            results: [{ name: "Paris", latitude: 48.8, longitude: 2.3 }],
          }),
        ),
      );
    return Promise.resolve(
      new Response(
        JSON.stringify({
          current: {
            temperature_2m: 20,
            apparent_temperature: 19,
            relative_humidity_2m: 50,
            weather_code: 0,
            wind_speed_10m: 1,
            wind_direction_10m: 0,
          },
        }),
      ),
    );
  }) as typeof fetch;
  const effect = createActiveEffect(
    page,
    async () => {
      controller?.abort();
      const request = (controller = new AbortController());
      try {
        const result = await fetchWeather(location, "c", request.signal);
        if (page.isActive() && !request.signal.aborted)
          shown.push(result.location);
      } catch {
        /* aborted */
      }
    },
    () => {
      controller?.abort();
      return true;
    },
  );
  try {
    void effect.request();
    page.set(true);
    expect(requested.length).toBe(1);
    page.set(false);
    expect(aborted).toBe(true);
    location = "Paris";
    void effect.request();
    page.set(true);
    for (let i = 0; i < 20 && shown.length === 0; i++) await Promise.resolve();
    expect(shown).toEqual(["Paris"]);
    expect(requested.length).toBe(3);
  } finally {
    effect.dispose();
    globalThis.fetch = originalFetch;
    if (originalStorage)
      Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("saved-font loading is deferred and abortable without touching applied faces or a user save", async () => {
  const page = activity(false);
  const owner = new FontRequestOwner();
  let desired = "A",
    applied = "earlier",
    loads = 0,
    saves = 0;
  const pending: (() => void)[] = [];
  const font = createActiveEffect(
    page,
    async () => {
      const request = owner.begin(),
        family = desired;
      loads++;
      await new Promise<void>((resolve) => pending.push(resolve));
      if (request.current()) applied = family;
    },
    () => {
      owner.cancel();
      return true;
    },
  );
  void font.request();
  desired = "B";
  void font.request();
  expect(loads).toBe(0);
  page.set(true);
  expect(loads).toBe(1);
  page.set(false);
  saves++; // A submitted persistence write is independent of the load owner.
  desired = "C";
  void font.request();
  requiredValue(pending.shift())();
  await Promise.resolve();
  expect(applied).toBe("earlier");
  expect(saves).toBe(1);
  page.set(true);
  expect(loads).toBe(2);
  requiredValue(pending.shift())();
  await Promise.resolve();
  expect(applied).toBe("C");
  font.dispose();
});

function fetchWeather(location: string, units: "c" | "f", signal: AbortSignal) {
  return fetchWeatherInjected(
    location,
    units,
    signal,
    browserWeatherEnvironment(() => true),
  );
}

// Test scheduling harness for real weather fetch and FontRequestOwner regressions.
function createActiveEffect(
  activity: ActivitySignal,
  run: () => Promise<void> | void,
  suspend: () => boolean = () => false,
): { request(): Promise<void> | undefined; dispose(): void } {
  let pending = false;
  let disposed = false;
  const request = (): Promise<void> | undefined => {
    if (disposed) return;
    if (!activity.isActive()) {
      pending = true;
      return;
    }
    pending = false;
    return Promise.resolve(run());
  };
  const unsubscribe = activity.subscribe((active) => {
    if (!active) {
      if (suspend()) pending = true;
    } else if (pending) void request();
  });
  return {
    request,
    dispose: () => {
      disposed = true;
      unsubscribe();
    },
  };
}
