<script lang="ts">
  import { listenOutsideDismiss } from "./outside-dismiss";
  import { createPresentationHandoff } from "./presentation-handoff";
  import { untrack } from "svelte";
  import SectionIcon from "./SectionIcon.svelte";
  import { SvelteMap } from "svelte/reactivity";
  import { onMount, tick, type Snippet } from "svelte";
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
    canNavigate = () => true,
    onRestoreFocus,
    onPresentationCommit = () => {},
  }: {
    services: AppServices;
    snapshot: SettingsSnapshot;
    open: boolean;
    category: SettingsCategory;
    onOpenChange: (open: boolean) => void;
    onCategoryChange: (category: SettingsCategory) => void;
    content: Snippet;
    scene?: HTMLElement;
    canClose?: (
      reason: "escape" | "close",
      owner?: SettingsCategory,
      resume?: () => void,
    ) => boolean;
    canNavigate?: (next: SettingsCategory, resume: () => void) => boolean;
    onRestoreFocus?: () => void;
    onPresentationCommit?: (mode: "modal" | "drawer") => void;
  } = $props();
  let sheet: HTMLDivElement;
  let scroll: HTMLDivElement;
  let panel: HTMLElement;
  let handoff: ReturnType<typeof createPresentationHandoff> | undefined;
  let committedMode: "modal" | "drawer" | undefined;
  onMount(() => {
    handoff = createPresentationHandoff(panel, project);
    const settle = () =>
      handoff?.settle(snapshot.settings.settingsPresentation);
    const stopMotion = services.subscribeReducedMotion(settle);
    window.addEventListener("resize", settle);
    const preventHiddenActivation = (event: Event) => {
      if (
        !panel.hasAttribute("data-presentation-handoff") ||
        !(event.target instanceof Element) ||
        !panel.contains(event.target) ||
        event.target.closest("#settings-close") ||
        (!panel.hasAttribute("data-presentation-morph") &&
          getComputedStyle(panel).opacity !== "0")
      )
        return;
      if (
        event instanceof KeyboardEvent &&
        ![
          "Enter",
          " ",
          "Tab",
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "Home",
          "End",
        ].includes(event.key)
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    for (const type of ["pointerdown", "click", "keydown"])
      sheet.addEventListener(type, preventHiddenActivation, true);
    const stopOutside = listenOutsideDismiss(
      window,
      () => (open ? panel : null),
      () => {
        close();
      },
    );
    $effect(() => {
      if (!open) stopOutside.reset();
    });
    return () => {
      stopOutside.destroy();
      stopMotion();
      window.removeEventListener("resize", settle);
      for (const type of ["pointerdown", "click", "keydown"])
        sheet.removeEventListener(type, preventHiddenActivation, true);
      handoff?.destroy();
      handoff = undefined;
    };
  });
  export function tunerReturnScroll(): number {
    return open ? scroll.scrollTop : 0;
  }
  export function restoreTunerReturn(top: number): void {
    if (!open) return;
    scroll.scrollTop = top;
    (
      sheet.querySelector<HTMLElement>("#effect-tune") ??
      sheet.querySelector<HTMLElement>("#settings-close")
    )?.focus({ preventScroll: true });
  }
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
  let projectionRevision = 0;
  function project(mode: "modal" | "drawer") {
    const revision = ++projectionRevision;
    const top = scroll.scrollTop;
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
    const selection =
      owner instanceof HTMLInputElement || owner instanceof HTMLTextAreaElement
        ? {
            start: owner.selectionStart,
            end: owner.selectionEnd,
            direction: owner.selectionDirection,
          }
        : undefined;
    const editorCategory = owner?.closest<HTMLElement>(
      "[data-settings-category]",
    )?.dataset.settingsCategory;
    const active =
      mode !== committedMode &&
      editorCategory &&
      categories.some((item) => item.id === editorCategory)
        ? (editorCategory as SettingsCategory)
        : category;
    committedMode = mode;
    onPresentationCommit(mode);
    if (active !== category) {
      projectedCategory = active;
      onCategoryChange(active);
    }
    projectSettingsPresentation(
      sheet,
      Array.from(
        sheet.querySelectorAll<HTMLButtonElement>("[data-settings-nav]"),
      ),
      sections,
      mode,
      active,
    );
    return tick().then(() => {
      if (!sheet.isConnected || revision !== projectionRevision) return;
      scroll.scrollTop = top;
      if (
        document.activeElement === owner &&
        selection?.start !== null &&
        selection?.end !== null &&
        (owner instanceof HTMLInputElement ||
          owner instanceof HTMLTextAreaElement) &&
        selection
      ) {
        owner.setSelectionRange(
          selection.start,
          selection.end,
          selection.direction ?? undefined,
        );
      }
      if (owner?.closest("[hidden], [inert]"))
        sheet
          .querySelector<HTMLButtonElement>("#settings-close")
          ?.focus({ preventScroll: true });
    });
  }
  let requestedMode: "modal" | "drawer" | undefined;
  let projectedCategory: SettingsCategory | undefined;
  $effect(() => {
    const mode = snapshot.settings.settingsPresentation;
    const visible = open;
    const activeCategory = category;
    untrack(() => {
      const changed = requestedMode !== undefined && requestedMode !== mode;
      const navigated =
        projectedCategory !== undefined && projectedCategory !== activeCategory;
      requestedMode = mode;
      projectedCategory = activeCategory;
      if (committedMode === undefined || !handoff) void project(mode);
      else if (!visible && mode !== committedMode) handoff.request(mode, true);
      else if (!visible || navigated) handoff.settle(mode);
      else if (changed) handoff.request(mode, services.reducedMotion());
      else if (!panel.hasAttribute("data-presentation-handoff"))
        void project(mode);
    });
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
  function close(
    reason: "escape" | "close" = "close",
    owner?: SettingsCategory,
  ) {
    handoff?.settle(snapshot.settings.settingsPresentation);
    if (
      canClose(reason, owner, () => {
        if (open) {
          handoff?.settle(snapshot.settings.settingsPresentation);
          onOpenChange(false);
        }
      })
    ) {
      handoff?.settle(snapshot.settings.settingsPresentation);
      onOpenChange(false);
    }
  }
  function select(next: SettingsCategory) {
    const navigate = () => {
      if (!open) return;
      handoff?.settle(snapshot.settings.settingsPresentation);
      onCategoryChange(next);
      if (snapshot.settings.settingsPresentation === "modal")
        scroll.scrollTo({ top: 0 });
      sheet
        .querySelector<HTMLButtonElement>(`[data-settings-nav="${next}"]`)
        ?.focus();
    };
    if (!canNavigate(next, navigate)) return;
    navigate();
  }
  function navKey(event: KeyboardEvent, id: SettingsCategory) {
    if (committedMode !== "modal") return;
    const next = categoryForKey(id, event.key);
    if (!next) return;
    event.preventDefault();
    select(next);
  }
  function keydown(event: KeyboardEvent) {
    if (!open || event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      const target =
        event.target instanceof HTMLElement
          ? event.target.closest<HTMLElement>("[data-settings-category]")
              ?.dataset.settingsCategory
          : undefined;
      const owner = categories.find((item) => item.id === target)?.id;
      close("escape", owner);
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
</script>

<div
  class="sheet"
  id="settings-sheet"
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
  <aside class="sheet__panel control-surface" bind:this={panel}>
    <header class="sheet__head">
      <div class="modal__title-group drawer__title-group">
        <h2 class="sheet__title modal__title drawer__title" id="settings-title">
          Lightfield Settings
        </h2>
        <span class="modal__subtitle drawer__subtitle">Preferences</span>
      </div>
      <div class="modal__header-actions">
        <button
          class="sheet__close icon-close modal__close-btn drawer__close-btn"
          id="settings-close"
          type="button"
          onclick={() => {
            close();
          }}
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
