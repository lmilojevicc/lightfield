import { createWeatherToggle } from "../../src/ui/shell/weather-toggle";
import { createNetworkConsent } from "../../src/app/network-consent";
import type { AppServices } from "../../src/services/contracts";
import { deferred, waitUntil } from "./deferred";
import { createPageVisibility } from "../../src/platform/page-visibility";
import type { PreparedLocalImage } from "../../src/platform/images/local-image-loading";
import type { PermissionAPI } from "../../src/platform/permissions";
import { expect, test } from "bun:test";
import {
  createServices,
  type ServiceDependencies,
} from "../../src/services/create-services";
import { createPermissions } from "../../src/platform/permissions";
import { normalize, STORAGE_KEY } from "../../src/domain/settings/schema";
import { CUSTOM_THEMES_KEY } from "../../src/domain/themes/custom-themes";
import { expectRejected } from "../platform/rejection";
import type { StorageAdapter } from "../../src/platform/storage/browser-storage";
import type { LocalImageAsset } from "../../src/platform/images/local-image-store";
import type { LocalImageAssetId } from "../../src/shared/local-image";
function fixture() {
  const values = new Map<string, unknown>();
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  let fail = false,
    active = true;
  const activityListeners = new Set<(value: boolean) => void>();
  const assets = new Map<LocalImageAssetId, LocalImageAsset>();
  let network = 0,
    disposed = 0;
  const storage: StorageAdapter = {
    read: (key) => Promise.resolve(structuredClone(values.get(key))),
    write: (key, value) => {
      if (fail) return Promise.reject(new Error("quota denied"));
      values.set(key, structuredClone(value));
      for (const listener of listeners.get(key) ?? []) listener(value);
      return Promise.resolve();
    },
    subscribe: (key, listener) => {
      let set = listeners.get(key);
      if (!set) {
        set = new Set();
        listeners.set(key, set);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
  };
  const deps: ServiceDependencies = {
    storage,
    permissions: createPermissions(),
    activity: {
      isActive: () => active,
      subscribe: (listener) => {
        activityListeners.add(listener);
        return () => {
          activityListeners.delete(listener);
        };
      },
      dispose: () => {
        activityListeners.clear();
        disposed++;
      },
    },
    assets: {
      get: (id) => Promise.resolve(assets.get(id)),
      put: (asset) => {
        assets.set(asset.id, asset);
        return Promise.resolve();
      },
      delete: (id) => {
        assets.delete(id);
        return Promise.resolve();
      },
    },
    prepareImage: () => Promise.reject(new Error("test decoder unavailable")),
    thumbnail: {
      hidden: () => false,
      createURL: () => "blob:tiny",
      revokeURL: () => {},
      prepare: () => Promise.reject(new Error("unused decoder")),
      thumbnail: () => Promise.resolve(new Blob()),
    },
    fontEnvironment: {
      fonts: new Set() as unknown as FontFaceSet,
      createFace: () => {
        throw new Error("no remote font");
      },
      remoteAllowed: () => false,
      fetch: () => {
        network++;
        return Promise.reject(new Error("network disabled"));
      },
    },
    weatherEnvironment: {
      allowed: () => false,
      now: () => 1000,
      geolocate: () => Promise.resolve({ latitude: 0, longitude: 0 }),
      fetch: () => {
        network++;
        return Promise.reject(new Error("network disabled"));
      },
      storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    },
    randomUUID: () => crypto.randomUUID(),
    now: () => 1000,
    reducedMotion: { current: () => true, subscribe: () => () => {} },
  };
  return {
    deps,
    values,
    listeners,
    fail: (value: boolean) => {
      fail = value;
    },
    external: (key: string, value: unknown) => {
      values.set(key, value);
      for (const listener of listeners.get(key) ?? []) listener(value);
    },
    active: (value: boolean) => {
      active = value;
      for (const listener of activityListeners) listener(value);
    },
    get network() {
      return network;
    },
    get disposed() {
      return disposed;
    },
  };
}
test("real session snapshots, async save/error/retry, current subscriptions and disposal; defaults stay offline", async () => {
  const h = fixture(),
    services = createServices({ dependencies: h.deps });
  const views: string[] = [];
  const stop = services.settings.subscribe((snapshot) => {
    views.push(snapshot.settings.theme);
  });
  await services.ready;
  expect(services.settings.current().ready).toBe(true);
  expect(services.fonts.current().state).toBe("ready");
  expect(h.network).toBe(0);
  expect(services.reducedMotion()).toBe(true);
  h.fail(true);
  const saving = services.settings.patch({ theme: "moss" });
  expect(services.settings.current().settings.theme).toBe("moss");
  await expectRejected(saving, "quota denied");
  expect(services.settings.current().durable.theme).toBe("midnight");
  expect(services.settings.current().persistence.failed).toBe(1);
  h.external(STORAGE_KEY, normalize({ theme: "ivory", glassBlur: 40 }));
  expect(services.settings.current().settings.theme).toBe("moss");
  expect(services.settings.current().settings.glassBlur).toBe(40);
  h.fail(false);
  await services.settings.retry();
  expect(services.settings.current().durable.theme).toBe("moss");
  expect(services.settings.current().persistence.status).toBe("saved");
  await expectRejected(
    services.settings.patch({ fonts: "mono" }),
    "fonts.save",
  );
  stop();
  services.dispose();
  services.dispose();
  expect(h.disposed).toBe(1);
  expect([...h.listeners.values()].every((set) => set.size === 0)).toBe(true);
  expect(views).toContain("moss");
});
test("unknown image schema retained verbatim; Web Locks absence is fail-closed", async () => {
  const h = fixture();
  const future = {
    ...normalize(null),
    localImage: { version: 7, future: "opaque" },
  };
  h.values.set(STORAGE_KEY, future);
  const services = createServices({ dependencies: h.deps });
  await services.ready;
  expect(services.settings.current().unsupportedImage).toBe(true);
  expect(services.settings.current().imageMutationsAvailable).toBe(false);
  await services.settings.patch({ twentyFourHour: true });
  expect(
    (h.values.get(STORAGE_KEY) as Record<string, unknown>).localImage,
  ).toEqual(future.localImage);
  await expectRejected(
    services.settings.patch({ background: "none" }),
    "unsupported",
  );
  await expectRejected(
    services.images.change("remove", services.images.intent()),
    "Web Locks",
  );
  services.dispose();
});
test("theme create/edit/duplicate/delete/undo/import transactions and readback reconciliation", async () => {
  const h = fixture(),
    services = createServices({ dependencies: h.deps });
  await services.ready;
  const theme = {
    id: "custom:one",
    name: "One",
    paper: "#11111b",
    ink: "#eeeeee",
    accent: "#74c7ec",
  };
  await services.themes.save(theme, null);
  expect(services.settings.current().durable.theme).toBe(theme.id);
  await services.themes.save({ ...theme, name: "Edited" }, theme.id);
  expect(services.themes.current()[0]?.name).toBe("Edited");
  await services.themes.duplicate(theme);
  expect(services.themes.current()).toHaveLength(2);
  await services.themes.remove(services.settings.current().durable.theme);
  expect(services.settings.current().durable.theme).toBe("midnight");
  await services.themes.undo();
  expect(services.themes.current()).toHaveLength(2);
  const exported = services.themes.export();
  const imported = await services.themes.import(exported);
  expect(imported.remappedCount).toBe(2);
  expect(services.themes.current()).toHaveLength(4);
  expect(Array.isArray(h.values.get(CUSTOM_THEMES_KEY))).toBe(true);
  services.dispose();
});
test("font denial cannot persist drafts or dispose active offline family", async () => {
  const h = fixture(),
    services = createServices({ dependencies: h.deps });
  await services.ready;
  const active = services.fonts.current().display;
  await expectRejected(services.fonts.save("Inter", "Inter"), "consent");
  expect(services.settings.current().durable.fonts).toBe("system");
  expect(services.fonts.current().display).toEqual(active);
  expect(h.network).toBe(0);
  services.dispose();
});
test("image facade flushes view-owned background tickets and retains cleanup-pending state without hiding failures", async () => {
  const h = fixture();
  h.deps.locks = {
    request: (
      _name: string,
      _options: LockOptions,
      work: () => Promise<unknown>,
    ) => work(),
  } as unknown as Pick<LockManager, "request">;
  let released = 0;
  h.deps.prepareImage = () =>
    Promise.resolve({
      image: {} as HTMLImageElement,
      metadata: {
        mime: "image/png",
        width: 1,
        height: 1,
        bytes: 1,
        orientation: 1,
      },
      width: 1,
      height: 1,
      dispose: () => {
        released++;
      },
    });
  const services = createServices({ dependencies: h.deps });
  await services.ready;
  services.settings.stage({ background: "waves" });
  const expected = services.images.intent();
  expect(expected.background).toBe("waves");
  await services.images.change("contain", expected);
  expect(services.settings.current().durable.background).toBe("waves");
  expect(services.settings.current().durable.backgroundRevision).toBe(2);
  const blob = new Blob(["x"], { type: "image/png" });
  (
    await services.images.import(
      blob,
      services.images.intent(),
      "cover",
      new AbortController().signal,
    )
  ).dispose();
  h.deps.assets.delete = () => Promise.reject(new Error("cleanup blocked"));
  (
    await services.images.import(
      blob,
      services.images.intent(),
      "cover",
      new AbortController().signal,
    )
  ).dispose();
  expect(services.images.current()).toEqual({
    state: "idle",
    error: null,
    cleanupPending: true,
  });
  expect(released).toBe(2);
  expect(Object.keys(services.images.assets)).toEqual(["get"]);
  await expectRejected(
    services.settings.patch({
      localImage: {
        ...services.settings.current().durable.localImage,
        assetId: null,
      },
    }),
    "images.import",
  );
  services.dispose();
});
for (const change of ["consent", "permission"] as const)
  test(`${change} revocation invalidates nonabortable weather even when authorization returns before geolocation completes`, async () => {
    const h = fixture();
    h.values.set(
      STORAGE_KEY,
      normalize({ showWeather: true, weatherLocation: "auto" }),
    );
    const geo = deferred<{ latitude: number; longitude: number }>();
    let started = false,
      allowed = true,
      calls = 0,
      caches = 0;
    h.deps.weatherEnvironment = {
      ...h.deps.weatherEnvironment,
      allowed: () => allowed,
      geolocate: () => {
        started = true;
        return geo.promise;
      },
      fetch: () => {
        calls++;
        return Promise.reject(new Error("Late forecast"));
      },
      storage: {
        getItem: () => null,
        removeItem: () => {},
        setItem: () => {
          caches++;
        },
      },
    };
    const removed = new Set<() => void>();
    const contains = deferred<boolean>();
    let hold = false;
    const api: PermissionAPI = {
      contains: () => (hold ? contains.promise : Promise.resolve(true)),
      request: () => Promise.reject(new Error("No startup prompt")),
      onAdded: { addListener: () => {}, removeListener: () => {} },
      onRemoved: {
        addListener: (fn) => {
          removed.add(fn);
        },
        removeListener: (fn) => {
          removed.delete(fn);
        },
      },
    };
    h.deps.permissions = createPermissions(api);
    const services = createServices({ dependencies: h.deps });
    await services.ready;
    await waitUntil(() => started);
    allowed = false;
    if (change === "consent") services.notifyConsentChanged();
    else {
      hold = true;
      for (const fn of removed) fn();
      expect(services.permissions.current().location).toBe(false);
    }
    allowed = true;
    geo.resolve({ latitude: 51, longitude: 0 });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(calls).toBe(0);
    expect(caches).toBe(0);
    expect(services.weather.current().temperature).toBe("--°");
    services.dispose();
    contains.resolve(false);
    expect(removed.size).toBe(0);
  });
test("explicit consent hook cancels staged font CSS without late faces or persistence", async () => {
  const h = fixture(),
    css = deferred<Response>();
  let allowed = true,
    requests = 0,
    faces = 0;
  h.deps.fontEnvironment = {
    ...h.deps.fontEnvironment,
    remoteAllowed: () => allowed,
    fetch: () => {
      requests++;
      return css.promise;
    },
    createFace: () => {
      faces++;
      throw new Error("No late binary");
    },
  };
  const services = createServices({ dependencies: h.deps });
  await services.ready;
  const saving = services.fonts.save("Inter", "Inter");
  const outcome = saving.catch((error: unknown) => error);
  await waitUntil(() => requests === 2);
  allowed = false;
  services.notifyConsentChanged();
  allowed = true;
  css.resolve(
    new Response(
      "@font-face{font-weight:400;src:url(https://fonts.gstatic.com/s/inter/v1/test.woff2)}",
    ),
  );
  expect(await outcome).toBeInstanceOf(Error);
  expect(faces).toBe(0);
  expect(services.settings.current().durable.fonts).toBe("system");
  services.dispose();
});
function visibleImageFixture() {
  const h = fixture();
  const page = new EventTarget(),
    window = new EventTarget();
  let hidden = false;
  h.deps.imageVisibility = createPageVisibility({
    document: {
      get hidden() {
        return hidden;
      },
      hasFocus: () => true,
      addEventListener: page.addEventListener.bind(page),
      removeEventListener: page.removeEventListener.bind(page),
    },
    window,
  });
  h.deps.locks = {
    request: (
      _name: string,
      _options: LockOptions,
      work: () => Promise<unknown>,
    ) => work(),
  } as unknown as Pick<LockManager, "request">;
  const prepared = deferred<PreparedLocalImage>();
  const signals: AbortSignal[] = [];
  h.deps.prepareImage = (_blob, _fit, signal) => {
    if (!signal) throw new Error("Missing owned signal");
    signals.push(signal);
    return new Promise((resolve, reject) => {
      const abort = () => {
        reject(new Error("Decode cancelled"));
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      void prepared.promise.then((value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      }, reject);
    });
  };
  return {
    ...h,
    signals,
    prepared,
    hide: () => {
      hidden = true;
      page.dispatchEvent(new Event("visibilitychange"));
    },
    pagehide: () => {
      window.dispatchEvent(new Event("pagehide"));
    },
  };
}
test("visible browser-window blur preserves a pending native image import", async () => {
  const h = visibleImageFixture(),
    services = createServices({ dependencies: h.deps });
  await services.ready;
  const work = services.images.import(
    new Blob(["x"]),
    services.images.intent(),
    "cover",
    new AbortController().signal,
  );
  await waitUntil(() => h.signals.length === 1);
  h.active(false);
  expect(h.signals[0]?.aborted).toBe(false);
  h.prepared.resolve({
    image: {} as HTMLImageElement,
    metadata: {
      mime: "image/png",
      width: 1,
      height: 1,
      bytes: 1,
      orientation: 1,
    },
    width: 1,
    height: 1,
    dispose: () => {},
  });
  (await work).dispose();
  expect(services.settings.current().durable.background).toBe("local-image");
  services.dispose();
});
for (const reason of ["hidden", "pagehide", "superseded", "dispose"] as const)
  test(`image ${reason} cancels a pending import without a pointer write`, async () => {
    const h = visibleImageFixture(),
      services = createServices({ dependencies: h.deps });
    await services.ready;
    const original = services.images.intent();
    const work = services.images.import(
      new Blob(["x"]),
      original,
      "cover",
      new AbortController().signal,
    );
    const outcome = work.catch((error: unknown) => error);
    await waitUntil(() => h.signals.length === 1);
    if (reason === "hidden") h.hide();
    else if (reason === "pagehide") h.pagehide();
    else if (reason === "dispose") services.dispose();
    else {
      const abort = new AbortController();
      const next = services.images
        .import(new Blob(["x"]), original, "cover", abort.signal)
        .catch((error: unknown) => error);
      abort.abort();
      await next;
    }
    expect(await outcome).toBeInstanceOf(Error);
    expect(services.settings.current().durable.localImage.assetId).toBeNull();
    services.dispose();
  });
test("validated transient theme preview never writes settings/themes; cancel applies latest committed selection", async () => {
  const h = fixture(),
    services = createServices({ dependencies: h.deps });
  await services.ready;
  const values = new Map<string, string>();
  const root = {
    dataset: { theme: "midnight" },
    style: {
      setProperty: (key: string, value: string) => {
        values.set(key, value);
      },
      removeProperty: (key: string) => {
        values.delete(key);
      },
    },
    getAttribute: () => null,
  } as unknown as HTMLElement;
  const originalDocument = Object.getOwnPropertyDescriptor(
      globalThis,
      "document",
    ),
    originalStyle = Object.getOwnPropertyDescriptor(
      globalThis,
      "getComputedStyle",
    );
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => ({ getContext: () => null }) },
  });
  Object.defineProperty(globalThis, "getComputedStyle", {
    configurable: true,
    value: () => ({ getPropertyValue: (key: string) => values.get(key) ?? "" }),
  });
  try {
    const draft = {
      id: "custom:draft",
      name: "Draft",
      paper: "#eeeeee",
      ink: "#111111",
      accent: "#0055aa",
    };
    services.applyTheme(root, draft);
    expect(root.dataset.theme).toBe(draft.id);
    expect(values.get("--color-paper")).toBe(draft.paper);
    expect(h.values.size).toBe(0);
    expect(services.themes.current()).toEqual([]);
    expect(() =>
      services.applyTheme(root, { ...draft, paper: "invalid" }),
    ).toThrow("Invalid");
    expect(root.dataset.theme).toBe(draft.id);
    const pending = services.settings.stage({ theme: "ivory" });
    services.applyTheme(root);
    expect(root.dataset.theme).toBe("midnight");
    pending.cancel();
    await services.settings.patch({ theme: "ivory" });
    services.applyTheme(root);
    expect(root.dataset.theme).toBe("ivory");
    expect(values.size).toBe(0);
    expect(h.values.has(CUSTOM_THEMES_KEY)).toBe(false);
  } finally {
    services.dispose();
    if (originalDocument)
      Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (originalStyle)
      Object.defineProperty(globalThis, "getComputedStyle", originalStyle);
    else Reflect.deleteProperty(globalThis, "getComputedStyle");
  }
});

function weatherToggleFixture() {
  const h = fixture();
  h.values.set(
    STORAGE_KEY,
    normalize({ weatherLocation: "London", showWeather: false }),
  );
  const events: string[] = [];
  const consent = createNetworkConsent({
    durable: () => services.settings.current().durable,
    weatherEnabled: () => services.settings.current().settings.showWeather,
    requestFonts: () => services.permissions.request("fonts"),
    notify: () => {
      services.notifyConsentChanged();
    },
    alive: () => true,
    report: () => {},
  });
  h.deps.weatherEnvironment.allowed = () => consent.weather();
  h.deps.weatherEnvironment.fetch = (url) => {
    events.push(url.includes("/search?") ? "geocode" : "forecast");
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
            : {
                current: {
                  temperature_2m: 20.6,
                  apparent_temperature: 19.4,
                  relative_humidity_2m: 50.4,
                  weather_code: 3,
                  wind_speed_10m: 3.7,
                  wind_direction_10m: 359.5,
                },
              },
        ),
      ),
    );
  };
  const services: AppServices = createServices({ dependencies: h.deps });
  const toggle = createWeatherToggle({
    settings: services.settings,
    requestLocation: () => {
      throw new Error("Manual city must not request location");
    },
    consent: () => {
      events.push("notify");
      services.notifyConsentChanged();
    },
  });
  return { h, services, consent, toggle, events };
}
test("composed manual-city opt-in authorizes/resets before synchronous stage and fetches from enable alone", async () => {
  const f = weatherToggleFixture();
  await f.services.ready;
  expect(f.events).toEqual([]);
  expect(f.consent.weather()).toBe(false);
  const stop = f.services.settings.subscribe((value) => {
    if (value.settings.showWeather) f.events.push("enabled");
  });
  await f.toggle.set(true, false);
  await waitUntil(() =>
    f.services.weather.current().temperature.includes("21"),
  );
  expect(f.events.indexOf("notify")).toBeLessThan(f.events.indexOf("enabled"));
  expect(f.events).toContain("geocode");
  expect(f.events).toContain("forecast");
  expect(f.services.weather.current().temperature).toContain("21");
  stop();
  f.toggle.dispose();
  f.services.dispose();
});
test("composed weather opt-ins follow external off/on and failed user writes without a local lifetime veto", async () => {
  const f = weatherToggleFixture();
  await f.services.ready;
  await f.toggle.set(true, false);
  await waitUntil(() => f.events.includes("forecast"));
  await f.toggle.set(false, false);
  expect(f.consent.weather()).toBe(false);
  f.h.external(
    STORAGE_KEY,
    normalize({ weatherLocation: "London", showWeather: true }),
  );
  await waitUntil(() => f.services.settings.current().settings.showWeather);
  expect(f.consent.weather()).toBe(true);
  await waitUntil(() =>
    f.services.weather.current().temperature.includes("21"),
  );
  f.h.fail(true);
  await expectRejected(f.toggle.set(false, false), /quota denied/);
  expect(f.consent.weather()).toBe(false); // failed owned off intent remains the real UI view
  expect(f.services.settings.current().durable.showWeather).toBe(true);
  f.h.fail(false);
  await f.services.settings.retry();
  expect(f.consent.weather()).toBe(false);
  f.h.fail(true);
  await expectRejected(f.toggle.set(true, false), /quota denied/);
  expect(f.consent.weather()).toBe(true);
  expect(f.services.settings.current().durable.showWeather).toBe(false);
  f.h.fail(false);
  await f.services.settings.retry();
  expect(f.consent.weather()).toBe(true);
  f.toggle.dispose();
  f.services.dispose();
});
