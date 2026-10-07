import {
  browserNamespaces,
  browserStorageEnvironment,
  browserPageEnvironment,
  browserFontEnvironment,
  browserWeatherEnvironment,
} from "./browser";
import { createBrowserStorage } from "./storage/browser-storage";
import { createPageVisibility } from "./page-visibility";
import { createPageActivity } from "./page-activity";
import { createLocalImageAssetStore } from "./images/local-image-store";
import {
  createImagePreparer,
  prepareLocalImageThumbnail,
  thumbnailFromPrepared,
} from "./images/local-image-loading";
import { createPermissions } from "./permissions";
import type {
  ServiceDependencies,
  NetworkConsent,
} from "../services/create-services";
export function createBrowserPlatform(
  consent: NetworkConsent,
): ServiceDependencies {
  const namespaces = browserNamespaces();
  const permissionAPI =
    namespaces.browser?.permissions ?? namespaces.chrome?.permissions;
  const permissions = createPermissions(permissionAPI);
  const locks = (navigator as Partial<Navigator>).locks;
  const media = matchMedia("(prefers-reduced-motion: reduce)");
  return {
    permissions,
    imageVisibility: createPageVisibility(browserPageEnvironment()),
    storage: createBrowserStorage(browserStorageEnvironment()),
    ...(locks ? { locks } : {}),
    activity: createPageActivity(browserPageEnvironment()),
    assets: createLocalImageAssetStore({
      open: (name, version) => indexedDB.open(name, version),
    }),
    prepareImage: createImagePreparer(),
    fontEnvironment: browserFontEnvironment(
      () => consent.fonts() && permissions.current().fonts,
    ),
    weatherEnvironment: browserWeatherEnvironment(
      () => consent.weather(),
      () => permissions.current().location,
    ),
    thumbnail: {
      hidden: () => document.hidden,
      createURL: (blob) => URL.createObjectURL(blob),
      revokeURL: (url) => {
        URL.revokeObjectURL(url);
      },
      prepare: prepareLocalImageThumbnail,
      thumbnail: thumbnailFromPrepared,
    },
    randomUUID: () => crypto.randomUUID(),
    now: () => Date.now(),
    reducedMotion: {
      current: () => media.matches,
      subscribe(listener) {
        const changed = () => {
          listener(media.matches);
        };
        media.addEventListener("change", changed);
        return () => {
          media.removeEventListener("change", changed);
        };
      },
    },
  };
}
