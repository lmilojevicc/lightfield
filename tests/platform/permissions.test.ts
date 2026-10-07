import { expect, test } from "bun:test";
import {
  createPermissions,
  type PermissionAPI,
  type PermissionSet,
} from "../../src/platform/permissions";
import { browserNamespaces } from "../../src/platform/browser";
for (const namespace of ["chrome", "browser"] as const)
  test(`${namespace} permissions prompt only from request, track removals, retain denial and clean up`, async () => {
    let allowed = false;
    const added = new Set<() => void>(),
      removed = new Set<() => void>();
    const requests: PermissionSet[] = [];
    const api: PermissionAPI = {
      contains: () => Promise.resolve(allowed),
      request: (request) => {
        requests.push(request);
        return Promise.resolve(allowed);
      },
      onAdded: {
        addListener: (listener) => {
          added.add(listener);
        },
        removeListener: (listener) => {
          added.delete(listener);
        },
      },
      onRemoved: {
        addListener: (listener) => {
          removed.add(listener);
        },
        removeListener: (listener) => {
          removed.delete(listener);
        },
      },
    };
    const previous = Object.getOwnPropertyDescriptor(globalThis, namespace);
    Object.defineProperty(globalThis, namespace, {
      configurable: true,
      value: { permissions: api },
    });
    try {
      const permissions = createPermissions(
        browserNamespaces()[namespace]?.permissions,
      );
      await permissions.refresh();
      expect(requests).toEqual([]);
      expect(await permissions.request("fonts")).toBe(false);
      expect(permissions.current().error).toContain("offline");
      expect(requests).toEqual([
        { origins: ["https://fonts.googleapis.com/*"] },
      ]);
      allowed = true;
      await permissions.request("location");
      expect(permissions.current().location).toBe(true);
      expect(requests.at(-1)).toEqual({ permissions: ["geolocation"] });
      allowed = false;
      for (const listener of removed) listener();
      await permissions.refresh();
      expect(permissions.current().fonts).toBe(false);
      permissions.dispose();
      expect(added.size + removed.size).toBe(0);
    } finally {
      if (previous) Object.defineProperty(globalThis, namespace, previous);
      else Reflect.deleteProperty(globalThis, namespace);
    }
  });
test("geolocation denied by native permission state never touches nonabortable navigator API", async () => {
  const { browserWeatherEnvironment } =
    await import("../../src/platform/browser");
  const env = browserWeatherEnvironment(
    () => true,
    () => false,
  );
  let message = "";
  try {
    await env.geolocate();
  } catch (error) {
    message = error instanceof Error ? error.message : "unknown";
  }
  expect(message).toBe("Enable location access or enter a city.");
});
