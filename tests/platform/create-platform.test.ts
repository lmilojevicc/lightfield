import { expect, test } from "bun:test";
import { createBrowserPlatform } from "../../src/platform/create-platform";
import type { PermissionSet } from "../../src/platform/permissions";

for (const firefox of [false, true])
  test(`platform selects ${firefox ? "Firefox optional extension" : "Chromium origin"} location even with both namespaces`, async () => {
    const originals = new Map<string, PropertyDescriptor | undefined>();
    const install = (key: string, value: unknown) => {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, value });
    };
    const requests: PermissionSet[] = [];
    let geo = 0;
    const namespace = {
      runtime: firefox ? { getBrowserInfo() {} } : {},
      permissions: {
        contains: () => Promise.resolve(true),
        request: (request: PermissionSet) => {
          requests.push(request);
          return Promise.resolve(true);
        },
        onAdded: { addListener() {}, removeListener() {} },
        onRemoved: { addListener() {}, removeListener() {} },
      },
    };
    const status = Object.assign(new EventTarget(), { state: "granted" });
    install("browser", namespace);
    install("chrome", namespace);
    install("navigator", {
      permissions: { query: () => Promise.resolve(status) },
      geolocation: {
        getCurrentPosition(success: () => void) {
          geo++;
          success();
        },
      },
    });
    install(
      "document",
      Object.assign(new EventTarget(), { hidden: false, hasFocus: () => true }),
    );
    install("window", new EventTarget());
    install("localStorage", {
      getItem: () => null,
      setItem() {},
      removeItem() {},
    });
    install("matchMedia", () =>
      Object.assign(new EventTarget(), { matches: false }),
    );
    try {
      const deps = createBrowserPlatform({
        fonts: () => false,
        weather: () => false,
      });
      try {
        await deps.permissions.refresh();
        expect(geo).toBe(0);
        expect(requests).toEqual([]);
        await deps.permissions.request("location");
        expect(geo).toBe(firefox ? 0 : 1);
        expect(requests).toEqual(
          firefox ? [{ permissions: ["geolocation"] }] : [],
        );
        await deps.permissions.request("fonts");
        expect(requests.at(-1)).toEqual({
          origins: ["https://fonts.googleapis.com/*"],
        });
      } finally {
        deps.permissions.dispose();
        deps.activity.dispose();
        deps.imageVisibility?.dispose();
      }
    } finally {
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  });
