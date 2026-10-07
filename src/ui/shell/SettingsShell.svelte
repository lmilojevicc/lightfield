<script lang="ts">
  import SectionIcon from "./SectionIcon.svelte";
  import { SvelteMap } from "svelte/reactivity";
  import { tick, type Snippet } from "svelte";
  import type { AppServices, SettingsSnapshot } from "../../services/contracts";
  import {
    categoryForKey,
    projectSettingsPresentation,
    type SettingsCategory,
  } from "./settings-presentation";
  const {
    services,
    snapshot,
    open,
    category,
    onOpenChange,
    onCategoryChange,
    content,
    scene,
    canClose = () => true,
    onRestoreFocus,
  }: {
    services: AppServices;
    snapshot: SettingsSnapshot;
    open: boolean;
    category: SettingsCategory;
    onOpenChange: (open: boolean) => void;
    onCategoryChange: (category: SettingsCategory) => void;
    content: Snippet;
    scene?: HTMLElement;
    canClose?: () => boolean;
    onRestoreFocus?: () => void;
  } = $props();
  let sheet: HTMLDivElement;
  let scroll: HTMLDivElement;
  const categories: {
    id: SettingsCategory;
    tab: string;
    panel: string;
    label: string;
  }[] = [
    {
      id: "search",
      tab: "tab-btn-search",
      panel: "search",
      label: "Search Engines",
    },
    {
      id: "appearance",
      tab: "tab-btn-themes",
      panel: "themes",
      label: "Themes & Colors",
    },
    {
      id: "background",
      tab: "tab-btn-backgrounds",
      panel: "backgrounds",
      label: "Backgrounds",
    },
    { id: "fonts", tab: "tab-btn-fonts", panel: "fonts", label: "Typography" },
    {
      id: "time-date",
      tab: "tab-btn-time-weather",
      panel: "time-weather",
      label: "Time & Weather",
    },
  ];
  const status = $derived(
    snapshot.persistence.status === "error"
      ? "Couldn’t save changes."
      : snapshot.persistence.status === "saving"
        ? "Saving…"
        : snapshot.persistence.status === "saved"
          ? "Saved."
          : "",
  );
  $effect(() => {
    const revision = snapshot.persistenceRevision;
    if (snapshot.persistence.status !== "saved") return;
    const timer = setTimeout(
      () => services.settings.clearSavedStatus(revision),
      1500,
    );
    return () => {
      clearTimeout(timer);
    };
  });
  let previousMode: "modal" | "drawer" | undefined;
  $effect(() => {
    const mode = snapshot.settings.settingsPresentation;
    const sections = new SvelteMap<SettingsCategory, HTMLElement>();
    for (const item of categories) {
      const section = sheet.querySelector<HTMLElement>(
        `[data-settings-category="${item.id}"]`,
      );
      if (section) sections.set(item.id, section);
    }
    const owner =
      document.activeElement instanceof HTMLElement &&
      sheet.contains(document.activeElement)
        ? document.activeElement
        : null;
    const editorCategory = owner?.closest<HTMLElement>(
      "[data-settings-category]",
    )?.dataset.settingsCategory;
    const active =
      mode !== previousMode &&
      editorCategory &&
      categories.some((item) => item.id === editorCategory)
        ? (editorCategory as SettingsCategory)
        : category;
    previousMode = mode;
    if (active !== category) onCategoryChange(active);
    projectSettingsPresentation(
      sheet,
      Array.from(
        sheet.querySelectorAll<HTMLButtonElement>("[data-settings-nav]"),
      ),
      sections,
      mode,
      active,
    );
    if (owner?.closest("[hidden], [inert]"))
      sheet.querySelector<HTMLButtonElement>("#settings-close")?.focus();
  });
  $effect(() => {
    if (!open) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const inert = scene?.inert;
    if (scene) scene.inert = true;
    let live = true;
    void tick().then(() => {
      if (live)
        sheet.querySelector<HTMLButtonElement>("#settings-close")?.focus();
    });
    return () => {
      live = false;
      if (scene) scene.inert = inert ?? false;
      if (onRestoreFocus) onRestoreFocus();
      else if (previous?.isConnected && !previous.closest("[inert], [hidden]"))
        previous.focus();
    };
  });
  function close() {
    if (canClose()) onOpenChange(false);
  }
  function select(next: SettingsCategory) {
    onCategoryChange(next);
    if (snapshot.settings.settingsPresentation === "modal")
      scroll.scrollTo({ top: 0 });
  }
  function navKey(event: KeyboardEvent, id: SettingsCategory) {
    if (snapshot.settings.settingsPresentation !== "modal") return;
    const next = categoryForKey(id, event.key);
    if (!next) return;
    event.preventDefault();
    select(next);
    sheet
      .querySelector<HTMLButtonElement>(`[data-settings-nav="${next}"]`)
      ?.focus();
  }
  function keydown(event: KeyboardEvent) {
    if (!open || event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const items = Array.from(
      sheet.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
      ),
    ).filter(
      (el) =>
        el.tabIndex >= 0 &&
        !el.matches(':disabled, [aria-disabled="true"]') &&
        !el.closest('[hidden], [inert], [aria-hidden="true"]') &&
        el.checkVisibility({ visibilityProperty: true }),
    );
    const first = items[0],
      last = items.at(-1);
    if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === sheet)
    ) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
  function backdrop(event: MouseEvent) {
    if (
      open &&
      event.target instanceof HTMLElement &&
      event.target.hasAttribute("data-close")
    )
      close();
  }
</script>

<svelte:window onclick={backdrop} />
<div
  class="sheet"
  id="settings-sheet"
  data-presentation={snapshot.settings.settingsPresentation}
  role="dialog"
  tabindex="-1"
  aria-modal={open}
  aria-labelledby="settings-title"
  inert={!open}
  bind:this={sheet}
  class:is-open={open}
  onkeydown={keydown}
>
  <!-- Settings Scrim Backdrop -->
  <div
    class="sheet__backdrop settings-scrim settings-modal-scrim"
    id="settings-scrim"
    data-close
    aria-hidden="true"
  ></div>
  <aside class="sheet__panel control-surface">
    <header class="sheet__head">
      <div class="modal__title-group drawer__title-group">
        <h2 class="sheet__title modal__title drawer__title" id="settings-title">
          lightfield Settings
        </h2>
        <span class="modal__subtitle drawer__subtitle">Preferences</span>
      </div>
      <div class="modal__header-actions">
        <button
          class="sheet__close icon-close modal__close-btn drawer__close-btn"
          id="settings-close"
          type="button"
          onclick={close}
          aria-label="Close settings"
          title="Close (Esc)"
        >
          <svg
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
            ><line x1="18" y1="6" x2="6" y2="18" /><line
              x1="6"
              y1="6"
              x2="18"
              y2="18"
            /></svg
          >
        </button>
      </div>
    </header>

    <div
      class="save-status"
      id="save-status"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span id="save-status-text">{status}</span>
      <button
        class="quiet-action"
        id="save-retry"
        type="button"
        hidden={snapshot.persistence.status !== "error"}
        onclick={() => {
          void services.settings.retry().catch(() => {});
        }}>Retry</button
      >
    </div>

    <div class="settings-layout modal__body">
      <!-- Source nav is the tablist; its buttons own all keyboard navigation. -->
      <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
      <nav
        class="settings-nav modal__tabs"
        role="tablist"
        aria-orientation="vertical"
        aria-label="Settings categories"
      >
        <div class="settings-nav__list" role="presentation">
          {#each categories as item (item.id)}
            <button
              class="settings-nav__item modal__tab-btn"
              class:is-active={category === item.id}
              id={item.tab}
              type="button"
              data-settings-nav={item.id}
              data-tab={item.panel}
              role="tab"
              aria-selected={category === item.id}
              aria-current={category === item.id}
              tabindex={category === item.id ? 0 : -1}
              onclick={() => {
                select(item.id);
              }}
              onkeydown={(event) => {
                navKey(event, item.id);
              }}
              ><SectionIcon category={item.id} /><span class="modal__tab-label"
                >{item.label}</span
              ></button
            >
          {/each}
        </div>
      </nav>

      <div
        class="settings-content modal__content drawer__body"
        bind:this={scroll}
      >
        {@render content()}
      </div>
    </div>
  </aside>
</div>
