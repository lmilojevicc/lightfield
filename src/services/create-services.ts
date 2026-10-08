import { createBrowserPlatform } from "../platform/create-platform";
import { createSettingsLock } from "../platform/storage/settings-lock";
import { observeClockFont } from "../platform/clock-digits";
import { applyTheme } from "../platform/theme";
import type { PermissionSession } from "../platform/permissions";
import type { CustomTheme } from "../shared/theme";
import { normalizeCustomTheme } from "../domain/themes/custom-themes";
import type { PageVisibility } from "../platform/page-visibility";
import type { Settings } from "../domain/settings/schema";
import type { StorageAdapter } from "../platform/storage/browser-storage";
import type { OwnedPageActivity } from "../platform/page-activity";
import type { LocalImageAssetStore } from "../platform/images/local-image-store";
import type { prepareLocalImage } from "../platform/images/local-image-loading";
import { fontPreset, fontRoleTokens } from "../domain/fonts/font-pairings";
import {
  STORAGE_KEY,
  reconcileCustomThemeSelection,
  strictImageSettings,
} from "../domain/settings/schema";
import { NativeSettingsSession } from "./settings-session";
import { NativeThemeSession } from "./theme-session";
import { NativeFontSession } from "./font-session";
import type { FontEnvironment } from "./custom-font-loading";
import { LocalImageWorkflow } from "./local-image-workflow";
import {
  LocalImageThumbnail,
  type ThumbnailEnvironment,
} from "./local-image-thumbnail";
import {
  WeatherChipController,
  weatherChipView,
  type WeatherChipView,
} from "./weather-chip";
import {
  fetchWeather,
  clearWeatherCache,
  type WeatherEnvironment,
} from "./weather";
import { IMAGE_CONFLICT, IMAGE_LOCK_REASON } from "../shared/local-image";
import type {
  AppServices,
  ImageSessionIntent,
  ImageSnapshot,
} from "./contracts";
export interface NetworkConsent {
  fonts(): boolean;
  weather(): boolean;
}
export interface ServiceDependencies {
  permissions: PermissionSession;
  storage: StorageAdapter;
  locks?: Pick<LockManager, "request">;
  activity: OwnedPageActivity;
  imageVisibility?: PageVisibility;
  assets: LocalImageAssetStore;
  prepareImage: typeof prepareLocalImage;
  thumbnail: ThumbnailEnvironment;
  fontEnvironment: FontEnvironment;
  weatherEnvironment: WeatherEnvironment;
  randomUUID(): string;
  now(): number;
  reducedMotion: {
    current(): boolean;
    subscribe(listener: (value: boolean) => void): () => void;
  };
}
/** No network is enabled by construction; persisted weather opt-in AND caller consent are required. */
export function createServices(
  options: {
    dependencies?: ServiceDependencies;
    consent?: NetworkConsent;
  } = {},
): AppServices {
  const deps =
    options.dependencies ??
    createBrowserPlatform(
      options.consent ?? { fonts: () => false, weather: () => false },
    );
  const store = {
    read: () => deps.storage.read(STORAGE_KEY),
    write: (settings: Settings) => deps.storage.write(STORAGE_KEY, settings),
  };
  const lock = createSettingsLock(store, deps.locks);
  const settings = new NativeSettingsSession(
    deps.storage,
    lock.run,
    lock.imageMutationsAvailable,
  );
  const themes = new NativeThemeSession(deps.storage, settings, lock.run, () =>
    deps.randomUUID(),
  );
  const fonts = new NativeFontSession(
    settings,
    deps.fontEnvironment,
    deps.activity,
  );
  let imageState: ImageSnapshot = {
    state: "idle",
    error: null,
    cleanupPending: false,
  };
  const imageListeners = new Set<(snapshot: ImageSnapshot) => void>();
  const emitImage = () => {
    for (const listener of imageListeners) listener({ ...imageState });
  };
  const image = new LocalImageWorkflow(
    deps.assets,
    lock.images,
    deps.prepareImage,
    { randomUUID: () => deps.randomUUID(), now: () => deps.now() },
    undefined,
    () => {
      imageState = { ...imageState, cleanupPending: true };
      emitImage();
    },
    {
      prepared: (current, next) => {
        settings.background.prepared(current, next);
      },
      acknowledged: (next) => {
        settings.background.acknowledged(next);
      },
      failed: (next) => {
        settings.background.failed(next);
      },
    },
  );
  const thumbnails = new Set<LocalImageThumbnail>();
  const clockObservers = new Set<ReturnType<typeof observeClockFont>>();
  const motionSubscriptions = new Set<() => void>();
  const imageRequests = new Set<AbortController>();
  let imageOwner: AbortController | null = null;
  let disposed = false;
  const isDisposed = () => disposed;
  let weatherView = weatherChipView(settings.current().settings, null);
  const weatherListeners = new Set<(view: WeatherChipView) => void>();
  const weather = new WeatherChipController({
    settings: () => settings.current().settings,
    isActive: () => !disposed && deps.activity.isActive(),
    fetch: (location, units, signal) =>
      fetchWeather(location, units, signal, deps.weatherEnvironment),
    clearCache: () => {
      clearWeatherCache(deps.weatherEnvironment.storage);
    },
    render: (view) => {
      if (disposed) return;
      weatherView = view;
      for (const listener of weatherListeners) listener({ ...view });
    },
  });
  let weatherKey = "";
  const unsettings = settings.subscribe((snapshot) => {
    if (!snapshot.ready) return;
    const value = snapshot.settings;
    const key = JSON.stringify([
      value.showWeather,
      value.weatherLocation,
      value.weatherUnits,
    ]);
    if (key !== weatherKey) {
      weatherKey = key;
      void weather.refresh();
    } else weather.renderRetained();
  });
  const unactivity = deps.activity.subscribe((active) => {
    if (!active) {
      weather.suspend();
    } else void weather.refresh();
  });
  const unvisibility = deps.imageVisibility?.subscribe((visible) => {
    if (!visible) for (const request of imageRequests) request.abort();
  });
  const notifyConsentChanged = () => {
    if (disposed) return;
    weather.reset();
    clearWeatherCache(deps.weatherEnvironment.storage);
    fonts.authorizationChanged();
  };
  const unrevocation =
    deps.permissions.subscribeRevocation(notifyConsentChanged);
  let permissionState = deps.permissions.current();
  const unpermissions = deps.permissions.subscribe((next) => {
    if (
      (permissionState.fonts && !next.fonts) ||
      (permissionState.location && !next.location)
    )
      notifyConsentChanged();
    const locationChanged = permissionState.location !== next.location;
    permissionState = next;
    const value = settings.current();
    if (
      locationChanged &&
      value.ready &&
      value.settings.showWeather &&
      value.settings.weatherLocation === "auto"
    )
      void weather.refresh();
  });
  const prepareIntent = async (expected: ImageSessionIntent) => {
    if (!lock.imageMutationsAvailable) throw new Error(IMAGE_LOCK_REASON);
    await settings.flushBackground();
    const before = strictImageSettings(await settings.store.read());
    settings.publish(before);
    const revision = settings.background.resolve(expected);
    if (
      before.background !== expected.background ||
      before.localImage.assetId !== expected.assetId ||
      before.backgroundRevision !== revision
    )
      throw new Error(IMAGE_CONFLICT);
    return { revision, assetId: expected.assetId };
  };
  const ready = Promise.all([
    settings.reload(),
    themes.load(),
    deps.permissions.refresh(),
  ]).then(async () => {
    if (disposed) return;
    const selected = settings.current().durable.theme;
    const reconciled = reconcileCustomThemeSelection(
      selected,
      themes.current(),
    );
    if (selected !== reconciled) await settings.patch({ theme: reconciled });
    await fonts.retry();
  });
  return {
    ready,
    notifyConsentChanged,
    permissions: deps.permissions,
    settings,
    themes,
    fonts,
    activity: deps.activity,
    images: {
      current: () => ({ ...imageState }),
      subscribe(listener) {
        imageListeners.add(listener);
        listener({ ...imageState });
        return () => {
          imageListeners.delete(listener);
        };
      },
      assets: { get: (id) => deps.assets.get(id) },
      prepare: deps.prepareImage,
      intent: () => {
        const value = settings.current().settings;
        return {
          ...settings.background.intent(value.backgroundRevision),
          background: value.background,
          assetId: value.localImage.assetId,
        };
      },
      async import(blob, expected, fit, signal) {
        if (disposed) throw new Error("Services disposed.");
        for (const request of imageRequests) request.abort();
        const controller = new AbortController();
        imageRequests.add(controller);
        imageOwner = controller;
        imageState = { ...imageState, state: "saving", error: null };
        emitImage();
        const abort = () => {
          controller.abort();
        };
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted || deps.imageVisibility?.isVisible() === false)
          abort();
        try {
          const intent = await prepareIntent(expected);
          const result = await image.import(
            blob,
            intent,
            fit,
            controller.signal,
          );
          settings.publish(result.settings);
          if (isDisposed() || controller.signal.aborted) {
            result.prepared.dispose();
            throw new Error("Image request cancelled.");
          }
          if (imageOwner === controller && !isDisposed()) {
            imageState = { ...imageState, state: "idle" };
            emitImage();
          }
          return result.prepared;
        } catch (error) {
          if (imageOwner === controller && !isDisposed()) {
            imageState = {
              ...imageState,
              state: "error",
              error:
                error instanceof Error ? error.message : "Image unavailable.",
            };
            emitImage();
          }
          throw error;
        } finally {
          imageRequests.delete(controller);
          signal.removeEventListener("abort", abort);
        }
      },
      async change(operation, expected, signal) {
        if (disposed) throw new Error("Services disposed.");
        for (const request of imageRequests) request.abort();
        const controller = new AbortController();
        imageRequests.add(controller);
        imageOwner = controller;
        imageState = { ...imageState, state: "saving", error: null };
        emitImage();
        const abort = () => {
          controller.abort();
        };
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted || deps.imageVisibility?.isVisible() === false)
          abort();
        try {
          const intent = await prepareIntent(expected);
          const next = await image.change(intent, operation, controller.signal);
          settings.publish(next);
          if (imageOwner === controller && !isDisposed()) {
            imageState = { ...imageState, state: "idle" };
            emitImage();
          }
          return next;
        } catch (error) {
          if (imageOwner === controller && !isDisposed()) {
            imageState = {
              ...imageState,
              state: "error",
              error:
                error instanceof Error ? error.message : "Image unavailable.",
            };
            emitImage();
          }
          throw error;
        } finally {
          imageRequests.delete(controller);
          signal?.removeEventListener("abort", abort);
        }
      },
      createThumbnail() {
        const thumbnail = new LocalImageThumbnail(deps.assets, deps.thumbnail);
        thumbnails.add(thumbnail);
        return thumbnail;
      },
    },
    weather: {
      current: () => ({ ...weatherView }),
      subscribe(listener) {
        weatherListeners.add(listener);
        listener({ ...weatherView });
        return () => {
          weatherListeners.delete(listener);
        };
      },
      refresh: () => weather.refresh(),
    },
    applyTheme(root: HTMLElement, draft?: CustomTheme) {
      if (draft !== undefined) {
        const valid = normalizeCustomTheme(draft);
        if (!valid) throw new Error("Invalid custom theme draft.");
        return applyTheme(root, valid.id, [valid]);
      }
      return applyTheme(
        root,
        settings.current().durable.theme,
        themes.current(),
      );
    },
    applyFonts(root) {
      const selected = settings.current().durable.fonts;
      root.dataset.fonts = selected;
      const current = fonts.current();
      const preset = selected === "custom" ? null : fontPreset(selected);
      const display = current.display ?? preset?.display,
        body = current.body ?? preset?.body;
      if (!display || !body) return;
      const tokens = fontRoleTokens(display, body, preset?.displayWeight);
      for (const [key, value] of Object.entries(tokens))
        root.style.setProperty(key, value);
      for (const observer of clockObservers) observer.refresh();
    },
    observeClockFont(element) {
      const observer = observeClockFont(element);
      clockObservers.add(observer);
      return {
        refresh: () => {
          observer.refresh();
        },
        dispose: () => {
          clockObservers.delete(observer);
          observer.dispose();
        },
      };
    },
    reducedMotion: () => deps.reducedMotion.current(),
    subscribeReducedMotion(listener) {
      const unsubscribe = deps.reducedMotion.subscribe(listener);
      motionSubscriptions.add(unsubscribe);
      return () => {
        motionSubscriptions.delete(unsubscribe);
        unsubscribe();
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const observer of clockObservers) observer.dispose();
      clockObservers.clear();
      for (const unsubscribe of motionSubscriptions) unsubscribe();
      motionSubscriptions.clear();
      for (const request of imageRequests) request.abort();
      imageRequests.clear();
      unsettings();
      unactivity();
      unvisibility?.();
      deps.imageVisibility?.dispose();
      unrevocation();
      unpermissions();
      weather.suspend();
      fonts.dispose();
      themes.dispose();
      settings.destroy();
      deps.activity.dispose();
      deps.permissions.dispose();
      for (const thumbnail of thumbnails) thumbnail.dispose();
      thumbnails.clear();
      weatherListeners.clear();
      imageListeners.clear();
    },
  };
}
