import type { FontEnvironment } from "../services/custom-font-loading";
import type { WeatherEnvironment } from "../services/weather";
import type {
  BrowserNamespace,
  StorageEnvironment,
} from "./storage/browser-storage";
import type { PageActivityEnvironment } from "./page-activity";
/** The sole extension-global discovery seam; consumers inject these narrow interfaces in tests. */
export function browserNamespaces(): {
  browser?: BrowserNamespace;
  chrome?: BrowserNamespace;
} {
  return globalThis as {
    browser?: BrowserNamespace;
    chrome?: BrowserNamespace;
  };
}
export function browserStorageEnvironment(): StorageEnvironment {
  return {
    ...browserNamespaces(),
    localStorage: {
      getItem: (key) => localStorage.getItem(key),
      setItem: (key, value) => {
        localStorage.setItem(key, value);
      },
    },
    events: window,
  };
}
export function browserPageEnvironment(): PageActivityEnvironment {
  const namespaces = browserNamespaces();
  const extension = namespaces.browser ?? namespaces.chrome;
  return { document, window, ...(extension ? { extension } : {}) };
}
export function browserFontEnvironment(
  remoteAllowed: () => boolean,
): FontEnvironment {
  return {
    fonts: document.fonts,
    fetch: (...args) => fetch(...args),
    createFace: (...args) => new FontFace(...args),
    remoteAllowed,
  };
}
export function browserWeatherEnvironment(
  allowed: () => boolean,
  locationAllowed: () => boolean = () => true,
): WeatherEnvironment {
  return {
    fetch: (...args) => fetch(...args),
    now: () => Date.now(),
    allowed,
    locationAllowed,
    storage: {
      getItem: (key) => localStorage.getItem(key),
      setItem: (key, value) => {
        localStorage.setItem(key, value);
      },
      removeItem: (key) => {
        localStorage.removeItem(key);
      },
    },
    geolocate: () =>
      new Promise((resolve, reject) => {
        if (!locationAllowed()) {
          reject(new Error("Enable location access or enter a city."));
          return;
        }
        const geolocation = (navigator as Partial<Navigator>).geolocation;
        if (!geolocation) {
          reject(new Error("Geolocation unavailable"));
          return;
        }
        geolocation.getCurrentPosition(
          (position) => {
            resolve(position.coords);
          },
          reject,
          { maximumAge: 10 * 60 * 1000, timeout: 8000 },
        );
      }),
  };
}
