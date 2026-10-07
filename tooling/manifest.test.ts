import { describe, expect, test } from "bun:test";
import {
  createManifest,
  developmentGeckoId,
  isTarget,
  targets,
} from "./manifest";

describe("generated MV3 manifests", () => {
  test.each([...targets])(
    "%s is a local page-only, storage-only page with gesture-only optional access",
    (target) => {
      const manifest = createManifest(target);
      expect(manifest.manifest_version).toBe(3);
      expect(manifest.name).toBe("lightfield");
      expect(manifest.chrome_url_overrides).toEqual({ newtab: "newtab.html" });
      expect(manifest.permissions).toEqual(["storage"]);
      expect(manifest.optional_permissions).toEqual(["geolocation"]);
      expect(manifest.optional_host_permissions).toEqual([
        "https://fonts.googleapis.com/*",
      ]);
      for (const key of [
        "background",
        "content_scripts",
        "host_permissions",
        "action",
        "web_accessible_resources",
      ]) {
        expect(manifest).not.toHaveProperty(key);
      }
      const csp = manifest.content_security_policy.extension_pages;
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("worker-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).not.toMatch(/unsafe-eval|localhost/);
      expect(csp.split(";").map((directive) => directive.trim())).toEqual([
        "default-src 'self'",
        "script-src 'self'",
        "worker-src 'self'",
        "object-src 'none'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' https://fonts.gstatic.com",
        "connect-src 'self' https://fonts.googleapis.com https://api.open-meteo.com https://geocoding-api.open-meteo.com",
      ]);
      expect(csp).toContain("font-src 'self' https://fonts.gstatic.com");
      expect(csp).toContain(
        "connect-src 'self' https://fonts.googleapis.com https://api.open-meteo.com https://geocoding-api.open-meteo.com",
      );
      // Weather and custom fonts will transmit data: do not predeclare "none".
      expect(manifest).not.toHaveProperty(
        "browser_specific_settings.gecko.data_collection_permissions",
      );
    },
  );

  test("only Firefox includes its explicit development-only identity", () => {
    expect(createManifest("chromium")).not.toHaveProperty(
      "browser_specific_settings",
    );
    expect(createManifest("firefox").browser_specific_settings?.gecko.id).toBe(
      developmentGeckoId,
    );
    expect(developmentGeckoId).toMatch(/@example\.invalid$/);
  });

  test("reject unknown build targets", () => {
    expect(isTarget("chromium")).toBe(true);
    expect(isTarget("firefox")).toBe(true);
    expect(isTarget("../../outside")).toBe(false);
    expect(isTarget("chrome")).toBe(false);
  });
});
