<script lang="ts">
  import { tick } from "svelte";
  import FontsSection from "../../../src/ui/fonts/FontsSection.svelte";
  import SettingsShell from "../../../src/ui/shell/SettingsShell.svelte";
  import { DEFAULT_SETTINGS } from "../../../src/domain/settings/schema";
  import { resolveFontFamily } from "../../../src/domain/fonts/font-pairings";
  import type {
    AppServices,
    FontSnapshot,
    FontSession,
    SettingsSnapshot,
  } from "../../../src/services/contracts";
  import type { FontsFixtureOptions } from "./fixture";

  let options: FontsFixtureOptions = {};
  let snapshot = $state<SettingsSnapshot>(makeSnapshot());
  let open = $state(true);
  let mounted = $state(true);
  let navigationRevision = $state(0);
  let fonts = $state<{ cancelEditor(): boolean; isCloseBlocked(): boolean }>();
  let fontState: FontSnapshot = {
    state: "idle",
    error: null,
    display: null,
    body: null,
  };
  let listener: ((value: FontSnapshot) => void) | undefined;
  let previews = 0,
    disposed = 0,
    retries = 0,
    saves = 0,
    consent = 0;
  let grant: ((value: boolean) => void) | undefined;
  let retry: ((failure: boolean) => void) | undefined;
  let save: (() => void) | undefined;
  let preview: (() => void) | undefined;
  function makeSnapshot(): SettingsSnapshot {
    const settings = {
      ...DEFAULT_SETTINGS,
      settingsPresentation: options.presentation ?? "modal",
      fonts: options.custom ? ("custom" as const) : ("system" as const),
      customDisplayFont: options.remote ? "Lora" : "Georgia",
      customBodyFont: "Arial",
    };
    return {
      settings,
      durable: settings,
      persistence: {
        status: "idle",
        dirty: 0,
        queued: 0,
        inFlight: 0,
        failed: 0,
      },
      persistenceRevision: 0,
      error: null,
      ready: true,
      unsupportedImage: false,
      imageMutationsAvailable: true,
    };
  }
  function emit(state: FontSnapshot["state"]) {
    fontState = {
      state,
      error: state === "error" ? "Owned saved-load failure" : null,
      display: resolveFontFamily("Georgia", "display"),
      body: resolveFontFamily("Arial", "body"),
    };
    listener?.(fontState);
  }
  const fontService: FontSession = {
    current: () => fontState,
    subscribe(callback) {
      listener = callback;
      callback(fontState);
      return () => {
        listener = undefined;
      };
    },
    async preview(display, body) {
      previews++;
      if (options.holdPreview)
        await new Promise<void>((done) => {
          preview = done;
        });
      return {
        display: resolveFontFamily(display, "display"),
        body: resolveFontFamily(body, "body"),
        dispose() {
          disposed++;
        },
      };
    },
    async save(display, body) {
      saves++;
      if (options.holdSave)
        await new Promise<void>((done) => {
          save = done;
        });
      const settings = {
        ...snapshot.settings,
        fonts: "custom" as const,
        customDisplayFont: display,
        customBodyFont: body,
      };
      snapshot = { ...snapshot, settings, durable: settings };
    },
    preset(tuple) {
      const settings = { ...snapshot.settings, ...tuple };
      snapshot = { ...snapshot, settings, durable: settings };
      return Promise.resolve();
    },
    async retry() {
      retries++;
      emit("loading");
      const failed = options.holdRetry
        ? await new Promise<boolean>((done) => {
            retry = done;
          })
        : false;
      emit(failed ? "error" : "ready");
      if (failed) throw new Error("Owned retry rejection");
    },
    cancel() {},
  };
  const services = {
    reducedMotion: () => true,
    subscribeReducedMotion: () => () => {},
    fonts: fontService,
    activity: {
      subscribe(callback: (active: boolean) => void) {
        callback(true);
        return () => {};
      },
    },
  } as AppServices;
  function requestConsent() {
    consent++;
    return options.holdConsent
      ? new Promise<boolean>((done) => {
          grant = done;
        })
      : true;
  }
  function close() {
    if (fonts?.isCloseBlocked()) return;
    fonts?.cancelEditor();
    navigationRevision++;
    open = false;
  }
  window.fontsFixture = {
    async reset(next) {
      mounted = false;
      await tick();
      options = next;
      previews = disposed = retries = saves = consent = 0;
      grant = undefined;
      retry = undefined;
      save = undefined;
      preview = undefined;
      snapshot = makeSnapshot();
      emit(next.failSaved ? "error" : "ready");
      open = true;
      navigationRevision++;
      mounted = true;
      await tick();
    },
    close,
    reopen() {
      navigationRevision++;
      open = true;
    },
    stats: () => ({
      previews,
      disposed,
      retries,
      saves,
      consent,
      display: snapshot.settings.customDisplayFont,
      body: snapshot.settings.customBodyFont,
      blocked: fonts?.isCloseBlocked() ?? false,
    }),
    consent(value) {
      grant?.(value);
    },
    finishRetry(failure = false) {
      retry?.(failure);
    },
    finishSave() {
      save?.();
    },
    finishPreview() {
      preview?.();
    },
    failSaved() {
      emit("error");
    },
  };
</script>

{#if mounted}
  <SettingsShell
    {services}
    {snapshot}
    {open}
    category="fonts"
    onCategoryChange={() => {}}
    onOpenChange={(value) => {
      if (value) open = true;
      else close();
    }}
    canClose={(reason) => {
      if (fonts?.isCloseBlocked()) return false;
      if (reason === "escape" && fonts?.cancelEditor()) return false;
      fonts?.cancelEditor();
      return true;
    }}
  >
    {#snippet content()}
      <FontsSection
        bind:this={fonts}
        {services}
        {snapshot}
        active={open}
        sessionOpen={open}
        {navigationRevision}
        onRequestFontConsent={requestConsent}
      />
    {/snippet}
  </SettingsShell>
{/if}
