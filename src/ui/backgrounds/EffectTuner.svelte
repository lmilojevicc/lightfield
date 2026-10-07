<script lang="ts">
  import { onMount } from "svelte";
  import type { AppServices, SettingsSnapshot } from "../../services/contracts";
  import type { BackgroundStatus } from "../../effects/runtime/contracts";
  import {
    selectedControls,
    tuningScope,
    attachToTuner,
  } from "./control-state";
  const {
    services,
    snapshot,
    backgroundStatus,
    open = false,
    shortcutVisible = true,
    onopen,
    onclose,
    onreturn,
    ontarget,
    onfeedback,
    onretry,
    dockTarget = null,
  }: {
    services: AppServices;
    snapshot: SettingsSnapshot;
    backgroundStatus: BackgroundStatus;
    open?: boolean;
    shortcutVisible?: boolean;
    onopen: () => void;
    onclose: () => void;
    onreturn: () => void;
    ontarget: (target: HTMLElement | null) => void;
    onfeedback: (target: HTMLElement | null) => void;
    onretry: () => void | Promise<void>;
    dockTarget?: HTMLElement | null;
  } = $props();
  let target = $state<HTMLDivElement>();
  let title = $state<HTMLHeadingElement>();
  let feedback = $state<HTMLDivElement>();
  let dock = $state<HTMLDivElement>();
  let aside = $state<HTMLElement>();
  let openedScope: string | null = null;
  let wasOpen = false;
  function isOpen() {
    return open;
  }
  $effect(() => {
    const scope = tuningScope(snapshot.settings);
    if (open && !wasOpen) {
      openedScope = scope;
      wasOpen = true;
      queueMicrotask(() => {
        if (isOpen())
          (
            target?.querySelector<HTMLElement>(
              'input:not(:disabled), select:not(:disabled), [role="slider"]',
            ) ?? title
          )?.focus({ preventScroll: true });
      });
    }
    if (open && (!scope || scope !== openedScope)) onclose();
    if (!open) {
      wasOpen = false;
      openedScope = null;
    }
    ontarget(open ? (target ?? null) : null);
    onfeedback(open ? (feedback ?? null) : null);
  });
  $effect(() => {
    if (!open || !dockTarget || !dock) return;
    const attachment = attachToTuner(dockTarget, dock);
    return () => {
      attachment.destroy();
    };
  });
  onMount(() => {
    const key = (event: KeyboardEvent) => {
      if (
        open &&
        aside?.contains(event.target as Node) &&
        event.key === "Escape"
      ) {
        event.preventDefault();
        onclose();
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      ontarget(null);
      onfeedback(null);
    };
  });
</script>

<button
  class="effect-shortcut"
  id="effect-shortcut"
  type="button"
  hidden={!shortcutVisible ||
    !snapshot.settings.showEffectShortcut ||
    open ||
    !tuningScope(snapshot.settings)}
  onclick={onopen}>Effect settings</button
>
<div class="tuning-dock" id="tuning-dock" bind:this={dock} hidden={!open}></div>
<aside
  class="effect-tuner control-surface"
  id="effect-tuner"
  aria-labelledby="effect-tuner-title"
  hidden={!open}
  inert={!open}
  bind:this={aside}
>
  <header class="popup-header">
    <h2
      class="sheet__title"
      id="effect-tuner-title"
      tabindex="-1"
      bind:this={title}
    >
      {selectedControls(snapshot.settings).name}
    </h2>
    <button
      class="icon-close"
      id="effect-tuner-close"
      type="button"
      aria-label="Close tuning"
      onclick={onclose}>×</button
    >
  </header>
  <button
    class="quiet-action effect-tuner__return"
    id="effect-tuner-return"
    type="button"
    onclick={onreturn}>Return to Settings</button
  >
  <div class="effect-tuner__body" id="effect-tuner-body">
    <div id="effect-tuner-feedback" bind:this={feedback}>
      <p
        class="control__hint"
        hidden={!backgroundStatus.message && !backgroundStatus.filterMessage}
        role="status"
      >
        {backgroundStatus.message || backgroundStatus.filterMessage}
      </p>
      <button
        class="btn btn--ghost"
        hidden={!backgroundStatus.message && !backgroundStatus.filterMessage}
        onclick={() => {
          void onretry();
        }}>Retry</button
      >
      <p class="control__hint" hidden={!snapshot.error} role="status">
        {snapshot.error}
      </p>
      <button
        class="btn btn--ghost"
        hidden={!snapshot.error}
        onclick={() => {
          void services.settings.retry().catch(() => {});
        }}>Retry</button
      >
    </div>
    <div id="effect-tuner-controls" bind:this={target}></div>
  </div>
</aside>
