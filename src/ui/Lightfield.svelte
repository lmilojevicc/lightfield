<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import { createServices } from "../services/create-services";
  import type { AppServices } from "../services/contracts";
  import type { LocalImageAssetId } from "../shared/local-image";
  import { BackgroundController } from "../effects/runtime/controller";
  import { readThemeColors } from "../platform/theme";
  import { createBootReveal } from "../app/boot-reveal";
  import { createNetworkConsent } from "../app/network-consent";
  import Island from "./shell/Island.svelte";
  import SettingsShell from "./shell/SettingsShell.svelte";
  import SearchSection from "./shell/SearchSection.svelte";
  import TimeDateSection from "./shell/TimeDateSection.svelte";
  import AppearanceSection from "./appearance/AppearanceSection.svelte";
  import FontsSection from "./fonts/FontsSection.svelte";
  import BackgroundSection from "./backgrounds/BackgroundSection.svelte";
  import EffectTuner from "./backgrounds/EffectTuner.svelte";
  import { tuningScope, attachToTuner } from "./backgrounds/control-state";
  import { applyUiMaterial } from "./shell/material";
  import type {
    SettingsCategory,
    SettingsPresentation,
  } from "./shell/settings-presentation";

  let alive = true;
  const consent = createNetworkConsent({
    durable: () => services.settings.current().durable,
    weatherEnabled: () => services.settings.current().settings.showWeather,
    requestFonts: () => services.permissions.request("fonts"),
    notify: () => {
      services.notifyConsentChanged();
    },
    alive: () => alive,
    report,
  });
  const services: AppServices = createServices({ consent });
  // Service snapshots are replacement-owned immutable data, not editable Svelte drafts.
  let snapshot = $state.raw(untrack(() => services.settings.current()));
  let imageState = $state.raw(untrack(() => services.images.current()));
  let fontState = $state.raw(untrack(() => services.fonts.current()));
  let permissionState = $state.raw(
    untrack(() => services.permissions.current()),
  );
  let controller: BackgroundController | undefined;
  let backgroundStatus = $state.raw({
    id: untrack(() => snapshot.settings.background),
    active: false,
    ready: false,
    mounting: false,
    idleReleased: false,
    message: "",
    filterMessage: "",
    diagnostic: null,
  } as ReturnType<BackgroundController["current"]>);
  let committedPresentation = $state<SettingsPresentation>(
    untrack(() => snapshot.settings.settingsPresentation),
  );
  let settingsOpen = $state(false);
  let tunerOpen = $state(false);
  let category = $state<SettingsCategory>("appearance");
  let island: {
    restoreSettingsFocus(): void;
  };
  let appearance: {
    cancelEditor(): boolean;
    isCloseBlocked(): boolean;
    requestExit(next: () => void): boolean;
  };
  let fonts: { cancelEditor(): boolean; isCloseBlocked(): boolean };
  let shell: {
    tunerReturnScroll(): number;
    restoreTunerReturn(top: number): void;
  };
  let sessionOpen = $state(false);
  let navigationRevision = $state(0);
  let backgroundScroll = 0;
  let themeEditor = $state({ open: false, busy: false });
  let fontEditor = $state({ open: false, busy: false });
  const editorOpen = $derived(themeEditor.open || fontEditor.open);
  const editorBusy = $derived(themeEditor.busy || fontEditor.busy);
  let tunerTarget = $state<HTMLElement | null>(null);
  let tunerFeedback = $state<HTMLElement | null>(null);
  let tunerActions = $state<HTMLElement | null>(null);
  let saved: HTMLParagraphElement;
  let failure = $state("");
  const busy = $derived(
    editorOpen ||
      editorBusy ||
      imageState.state === "saving" ||
      fontState.state === "loading",
  );
  const savedText = $derived(
    snapshot.error ??
      (snapshot.persistence.status === "saving"
        ? "Saving…"
        : snapshot.persistence.status === "saved"
          ? "Saved."
          : ""),
  );
  const resolveAsset = (path: string) => new URL(path, document.baseURI).href;
  function report(error: unknown) {
    if (alive)
      failure = error instanceof Error ? error.message : "Couldn’t load lightfield.";
  }
  function synchronize() {
    if (!alive) return;
    try {
      const root = document.documentElement;
      const palette = services.applyTheme(root);
      applyUiMaterial(root, snapshot.settings, palette);
      services.applyFonts(root);
      root.dataset.dateExpanded = String(snapshot.settings.dateExpanded);
      root.dataset.background = snapshot.settings.background;
      root.dataset.fonts = snapshot.settings.fonts;
      const work = controller?.set(
        snapshot.settings.background,
        snapshot.settings.backgroundOverrides,
        palette,
        snapshot.settings.localImage,
        snapshot.settings.backgroundRevision,
      );
      if (work) void work.catch(report);
    } catch (error) {
      report(error);
    }
  }
  function showSettings() {
    navigationRevision++;
    sessionOpen = true;
    tunerOpen = false;
    settingsOpen = true;
  }
  function openSettings() {
    if (tunerOpen || (sessionOpen && !settingsOpen)) returnSettings();
    else showSettings();
  }
  function canClose(
    reason: "escape" | "close",
    owner = category,
    resume = () => {
      changeOpen(false);
    },
  ) {
    if (
      appearance.isCloseBlocked() ||
      fonts.isCloseBlocked() ||
      imageState.state === "saving"
    )
      return false;
    if (reason === "escape") {
      if (owner === "fonts" && fonts.cancelEditor()) return false;
      if (appearance.cancelEditor()) return false;
    } else {
      const revision = navigationRevision;
      if (
        !appearance.requestExit(() => {
          if (alive && settingsOpen && revision === navigationRevision)
            resume();
        })
      )
        return false;
      fonts.cancelEditor();
    }
    return true;
  }
  function changeOpen(open: boolean) {
    navigationRevision++;
    settingsOpen = open;
    sessionOpen = open;
  }
  function openTuner() {
    if (!tuningScope(snapshot.settings)) return;
    backgroundScroll = shell.tunerReturnScroll();
    navigationRevision++;
    sessionOpen = true;
    settingsOpen = false;
    tunerOpen = true;
  }
  function closeTuner() {
    tunerOpen = false;
    navigationRevision++;
    void tick()
      .then(() => {
        if (alive && !tunerOpen && !settingsOpen) island.restoreSettingsFocus();
      })
      .catch(report);
  }
  function returnSettings() {
    category = "background";
    showSettings();
    const navigation = navigationRevision;
    void tick()
      .then(async () => {
        await tick();
        if (alive && settingsOpen && navigation === navigationRevision)
          shell.restoreTunerReturn(backgroundScroll);
      })
      .catch(report);
  }
  function retry() {
    failure = "";
    if (controller) void controller.retry().catch(report);
  }
  $effect(() => {
    if (!tunerOpen || !tunerFeedback) return;
    const attachment = attachToTuner(saved, tunerFeedback);
    return () => {
      attachment.destroy();
    };
  });
  onMount(() => {
    const host = document.getElementById("background-host");
    const tuner = document.getElementById("effect-tuner");
    if (!host || !tuner) throw new Error("Missing lightfield composition host");
    controller = new BackgroundController(host, {
      activity: services.activity,
      images: services.images,
      reducedMotion: () => services.reducedMotion(),
      subscribeReducedMotion: (listener) =>
        services.subscribeReducedMotion(listener),
      resolveAsset,
    });
    const boot = createBootReveal({
      reveal: () => {
        document.body.classList.remove("booting");
      },
      schedule: (callback, ms) => setTimeout(callback, ms),
      cancel: (timer) => {
        clearTimeout(timer as ReturnType<typeof setTimeout>);
      },
    });
    const stops = [
      controller.subscribe((status) => {
        backgroundStatus = status;
        if (status.ready) boot.painted();
      }),
      services.settings.subscribe((value) => {
        snapshot = value;
        synchronize();
      }),
      services.themes.subscribe(() => {
        synchronize();
      }),
      services.fonts.subscribe((value) => {
        fontState = value;
        services.applyFonts(document.documentElement);
      }),
      services.images.subscribe((value) => {
        imageState = value;
      }),
      services.permissions.subscribe((value) => {
        permissionState = value;
      }),
    ];
    void services.ready
      .then(() => {
        synchronize();
        boot.initialized();
      })
      .catch((error: unknown) => {
        report(error);
        boot.failed();
      });
    return () => {
      alive = false;
      boot.dispose();
      for (const stop of stops) stop();
      controller?.destroy();
      services.dispose();
      document.body.classList.remove("booting");
    };
  });
</script>

<Island
  bind:this={island}
  {services}
  {snapshot}
  overlayOpen={settingsOpen || tunerOpen}
  sceneHidden={tunerOpen}
  {busy}
  tuneAvailable={!!tuningScope(snapshot.settings)}
  onOpenSettings={openSettings}
  onOpenTuner={openTuner}
/>
<SettingsShell
  bind:this={shell}
  {services}
  {snapshot}
  open={settingsOpen}
  {category}
  {canClose}
  canNavigate={(next: SettingsCategory, resume: () => void) => {
    if (next === category) return true;
    if (fonts.isCloseBlocked() || imageState.state === "saving") return false;
    const revision = navigationRevision;
    return appearance.requestExit(() => {
      if (alive && settingsOpen && revision === navigationRevision) resume();
    });
  }}
  onPresentationCommit={(mode: SettingsPresentation) => {
    committedPresentation = mode;
  }}
  onOpenChange={changeOpen}
  onCategoryChange={(next: SettingsCategory) => {
    if (category !== next) navigationRevision++;
    category = next;
  }}
  onRestoreFocus={() => {
    if (!tunerOpen) island.restoreSettingsFocus();
  }}
>
  {#snippet content()}
    <SearchSection {services} {snapshot} />
    <AppearanceSection
      bind:this={appearance}
      {services}
      {snapshot}
      {sessionOpen}
      active={settingsOpen &&
        (category === "appearance" || committedPresentation === "drawer")}
      readThemeColors={() => readThemeColors(document.documentElement)}
      onEditorStateChange={(open: boolean, busy: boolean) => {
        themeEditor = { open, busy };
      }}
    />
    <BackgroundSection
      {services}
      {snapshot}
      {backgroundStatus}
      visible={settingsOpen &&
        (category === "background" || committedPresentation === "drawer")}
      {tunerTarget}
      {tunerFeedback}
      {tunerActions}
      onopen={openTuner}
      onretry={retry}
      {resolveAsset}
      borrowThumbnail={(assetId: LocalImageAssetId) =>
        controller?.borrowThumbnail(assetId)}
    />
    <FontsSection
      bind:this={fonts}
      {services}
      {snapshot}
      {sessionOpen}
      active={settingsOpen &&
        (category === "fonts" || committedPresentation === "drawer")}
      {navigationRevision}
      onRequestFontConsent={() => consent.requestFonts()}
      onEditorStateChange={(open: boolean, busy: boolean) => {
        fontEditor = { open, busy };
      }}
    />
    <TimeDateSection {services} {snapshot} />
  {/snippet}
</SettingsShell>
<EffectTuner
  {services}
  {snapshot}
  {backgroundStatus}
  open={tunerOpen}
  shortcutVisible={false}
  onactions={(target: HTMLElement | null) => {
    tunerActions = target;
  }}
  onopen={openTuner}
  onclose={closeTuner}
  onreturn={returnSettings}
  ontarget={(target: HTMLElement | null) => {
    tunerTarget = target;
  }}
  onfeedback={(target: HTMLElement | null) => {
    tunerFeedback = target;
  }}
  onretry={retry}
/>
<p
  bind:this={saved}
  class="control__hint"
  role="status"
  hidden={!tunerOpen || !savedText}
>
  {savedText}
</p>
<p id="background-status" class="visually-hidden" role="status">
  {failure ||
    backgroundStatus.message ||
    backgroundStatus.filterMessage ||
    permissionState.error ||
    ""}
</p>
