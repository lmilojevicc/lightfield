import { expect, test } from "bun:test";
import {
  createBrowserStorage,
  type BrowserNamespace,
  type StorageChange,
} from "../../src/platform/storage/browser-storage";
import {
  STORAGE_KEY,
  SETTINGS_WRITE_LOCK_NAME,
} from "../../src/domain/settings/schema";
import { CUSTOM_THEMES_KEY } from "../../src/domain/themes/custom-themes";
import { LOCAL_IMAGE_DATABASE } from "../../src/platform/images/local-image-store";
import { CACHE_KEY } from "../../src/services/weather";
import { expectRejected } from "./rejection";
function namespace() {
  const values: Record<string, unknown> = {};
  const reads: string[] = [];
  const listeners = new Set<
    (changes: Record<string, StorageChange>, area: string) => void
  >();
  let fail = false;
  const api: BrowserNamespace = {
    storage: {
      local: {
        get: (key) => {
          reads.push(key);
          return fail
            ? Promise.reject(new Error("read denied"))
            : Promise.resolve({ [key]: values[key] });
        },
        set: (next) => {
          if (fail) return Promise.reject(new Error("write denied"));
          Object.assign(values, next);
          return Promise.resolve();
        },
      },
      onChanged: {
        addListener: (listener) => {
          listeners.add(listener);
        },
        removeListener: (listener) => {
          listeners.delete(listener);
        },
      },
    },
  };
  return {
    api,
    reads,
    values,
    listeners,
    fail: () => {
      fail = true;
    },
    event: (changes: Record<string, StorageChange>, area = "local") => {
      for (const listener of listeners) listener(changes, area);
    },
  };
}
for (const key of ["browser", "chrome"] as const)
  test(`${key} Promise storage preserves rejection, filters areas and disposes subscriptions`, async () => {
    const ns = namespace();
    const storage = createBrowserStorage({ [key]: ns.api });
    expect(await storage.read(STORAGE_KEY)).toBeUndefined();
    await storage.write(STORAGE_KEY, { theme: "moss" });
    expect(await storage.read(STORAGE_KEY)).toEqual({ theme: "moss" });
    const changes: unknown[] = [];
    const stop = storage.subscribe(STORAGE_KEY, (value) => {
      changes.push(value);
    });
    ns.event({ [STORAGE_KEY]: { newValue: { theme: "ivory" } } }, "sync");
    ns.event({ other: { newValue: true } });
    ns.event({ [STORAGE_KEY]: { newValue: { theme: "ivory" } } });
    ns.event({ [STORAGE_KEY]: {} });
    expect(changes).toEqual([{ theme: "ivory" }, undefined]);
    stop();
    expect(ns.listeners.size).toBe(0);
    ns.fail();
    await expectRejected(storage.read(STORAGE_KEY), "read denied");
    await expectRejected(storage.write(STORAGE_KEY, {}), "write denied");
    expect(ns.reads.every((value) => value === "lightfield:settings")).toBe(
      true,
    );
  });
test("both namespaces prefer Firefox browser without duplicate reads/writes", async () => {
  const browser = namespace(),
    chrome = namespace();
  const storage = createBrowserStorage({
    browser: browser.api,
    chrome: chrome.api,
  });
  await storage.write(STORAGE_KEY, 7);
  expect(await storage.read(STORAGE_KEY)).toBe(7);
  expect(browser.values[STORAGE_KEY]).toBe(7);
  expect(chrome.reads).toEqual([]);
  expect(chrome.values).toEqual({});
});
test("fresh keys and databases, never legacy storage migration", () => {
  expect([
    STORAGE_KEY,
    CUSTOM_THEMES_KEY,
    CACHE_KEY,
    SETTINGS_WRITE_LOCK_NAME,
    LOCAL_IMAGE_DATABASE,
  ]).toEqual([
    "lightfield:settings",
    "lightfield:custom-themes",
    "lightfield:weather",
    "lightfield:settings-write:v1",
    "lightfield:local-images",
  ]);
});
test("standalone fallback rejects corrupted JSON rather than silently replacing authority", async () => {
  const values = new Map([[STORAGE_KEY, "{broken"]]);
  const storage = createBrowserStorage({
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    },
  });
  await expectRejected(storage.read(STORAGE_KEY), /JSON/);
  await storage.write(STORAGE_KEY, { theme: "moss" });
  expect(await storage.read(STORAGE_KEY)).toEqual({ theme: "moss" });
});
