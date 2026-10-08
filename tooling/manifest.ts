export const targets = ["chromium", "firefox"] as const;
export type Target = (typeof targets)[number];

// Development-only identity; owner must choose a stable ID before distribution.
export const developmentGeckoId = "lightfield-development@example.invalid";

export function isTarget(value: string): value is Target {
  return targets.some((target) => target === value);
}

export function createManifest(target: Target) {
  return {
    manifest_version: 3,
    name: "lightfield",
    version: "0.1.0",
    description: "lightfield new-tab extension.",
    icons: {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png",
    },
    chrome_url_overrides: { newtab: "newtab.html" },
    // Native services use storage. Network/location prompts belong to explicit user gestures.
    permissions: ["storage"],
    ...(target === "firefox" ? { optional_permissions: ["geolocation"] } : {}),
    optional_host_permissions: ["https://fonts.googleapis.com/*"],
    content_security_policy: {
      extension_pages:
        "default-src 'self'; script-src 'self'; worker-src 'self'; object-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://fonts.googleapis.com https://api.open-meteo.com https://geocoding-api.open-meteo.com",
    },
    ...(target === "firefox"
      ? {
          browser_specific_settings: {
            gecko: { id: developmentGeckoId },
          },
        }
      : {}),
  };
}
