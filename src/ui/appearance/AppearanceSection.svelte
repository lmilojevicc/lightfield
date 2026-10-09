<script lang="ts">
  import { onMount, tick } from "svelte";
  import { SvelteMap } from "svelte/reactivity";
  import type { AppServices, SettingsSnapshot } from "../../services/contracts";
  import type { SettingsPatch } from "../../domain/settings/schema";
  import type { CustomTheme } from "../../shared/theme";
  import { CUSTOM_THEME_IMPORT_MAX_BYTES } from "../../domain/themes/custom-themes";
  import ThemeEditor from "./ThemeEditor.svelte";
  import { THEME_CARDS, themeMatchesSearch } from "./theme-cards";
  import { customThemeSwatches, themeTone } from "./theme-draft";
  import { themeDraft } from "./theme-draft";
  import { duplicateCustomTheme } from "../../domain/themes/custom-themes";
  import { readThemeColors as readColors } from "../../platform/theme";
  const {
    services,
    snapshot,
    active = true,
    sessionOpen = true,
    readThemeColors,
    onFocusReturn,
    onEditorStateChange,
  }: {
    services: AppServices;
    snapshot: SettingsSnapshot;
    active?: boolean;
    sessionOpen?: boolean;
    readThemeColors: () => Pick<CustomTheme, "paper" | "ink" | "accent">;
    onFocusReturn?: () => void;
    onEditorStateChange?: (open: boolean, busy: boolean) => void;
  } = $props();
  export function isCloseBlocked(): boolean {
    return busy;
  }
  export function requestExit(next: () => void): boolean {
    if (menuId) {
      closeMenu();
      return false;
    }
    if (busy) return false;
    if (!draft) return true;
    if (JSON.stringify(draft) !== baseline) {
      pendingExit = next;
      void tick().then(() => {
        if (pendingExit && alive)
          section
            .querySelector<HTMLButtonElement>("#custom-keep-editing")
            ?.focus();
      });
      return false;
    }
    cancel(false);
    return true;
  }
  export function cancelEditor(): boolean {
    if (!draft) return false;
    if (
      requestExit(() => {
        cancel();
      })
    )
      cancel();
    return true;
  }
  $effect(() => onEditorStateChange?.(draft !== null, busy));
  let library = $state<"presets" | "custom">("presets");
  let baseline = "";
  let pendingExit = $state<(() => void) | null>(null);
  let menuId = $state<string | null>(null);
  let menuTrigger: HTMLButtonElement | null = null;
  let deleteTarget = $state<CustomTheme | null>(null);
  let deletedName = $state("");
  let conflict = $state(false);
  let focusRevision = 0;
  let returnScroll = 0;
  let returnInvoker: {
    kind: "more" | "edit" | "customize";
    themeId: string;
  } | null = null;
  let themes = $state<readonly CustomTheme[]>([]);
  let query = $state("");
  let draft = $state<CustomTheme | null>(null);
  let editingId = $state<string | null>(null);
  let busy = $state(false);
  let status = $state("");
  let undo = $state(false);
  let alive = true;
  let undoTimer: ReturnType<typeof setTimeout> | undefined;
  const downloads = new SvelteMap<string, ReturnType<typeof setTimeout>>();
  let section: HTMLElement;
  let search = $state<HTMLInputElement>();
  let file: HTMLInputElement;
  let returnFocus: HTMLElement | null = null;
  const preferences = [
    {
      key: "settingsPresentation",
      label: "Settings Presentation",
      id: "settings-presentation-label",
      values: [
        ["modal", "Modal"],
        ["drawer", "Drawer"],
      ],
    },
    {
      key: "islandMode",
      label: "Island mode",
      id: "island-mode-label",
      values: [
        ["normal", "Normal"],
        ["hidden", "Hidden"],
      ],
    },
  ] as const;
  const visibleCount = $derived(
    (library === "presets" ? THEME_CARDS : themes).filter((t) =>
      themeMatchesSearch(query, t.name, t.id),
    ).length,
  );
  onMount(() => {
    const stop = services.themes.subscribe((value) => {
      if (draft && !busy && JSON.stringify(value) !== JSON.stringify(themes)) {
        conflict = true;
        status =
          "Themes changed elsewhere. Your draft is preserved. Discard to reload, or save to keep your changes.";
      }
      themes = value;
    });
    return () => {
      alive = false;
      clearTimeout(undoTimer);
      for (const [url, timer] of downloads) {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
      }
      downloads.clear();
      stop();
    };
  });
  $effect(() => {
    if (!sessionOpen && !draft) {
      pendingExit = null;
      menuId = null;
    }
  });
  async function run(action: () => Promise<unknown>, message = "") {
    if (busy) return false;
    busy = true;
    status = "";
    try {
      await action();
      if (!alive) return false;
      if (message) status = message;
      return true;
    } catch (error) {
      status =
        error instanceof Error ? error.message : "Couldn’t save this theme.";
      return false;
    } finally {
      busy = false;
    }
  }
  function patch(value: SettingsPatch) {
    void services.settings.patch(value).catch((error: unknown) => {
      status =
        error instanceof Error ? error.message : "Couldn’t save settings.";
    });
  }
  function change(value: CustomTheme) {
    draft = value;
  }
  async function open(
    theme?: CustomTheme,
    invoker?: HTMLElement,
    newDraft = false,
  ) {
    closeMenu(false);
    const target = invoker ?? document.activeElement;
    returnFocus =
      target instanceof HTMLElement && section.contains(target) ? target : null;
    const themeId =
      returnFocus?.closest<HTMLElement>("[data-theme-card]")?.dataset.themeCard;
    returnInvoker = themeId
      ? {
          themeId,
          kind: returnFocus?.classList.contains("theme-more")
            ? "more"
            : library === "presets"
              ? "customize"
              : "edit",
        }
      : null;
    returnScroll =
      section.closest<HTMLElement>(".settings-content")?.scrollTop ?? 0;
    editingId = theme && !newDraft ? theme.id : null;
    draft = theme
      ? { ...theme }
      : {
          id: services.themes.createId(),
          name: "Untitled theme",
          ...readThemeColors(),
        };
    baseline = JSON.stringify(draft);
    conflict = false;
    pendingExit = null;
    status = "";
    const revision = ++focusRevision;
    await tick();
    if (alive && revision === focusRevision)
      section.querySelector<HTMLInputElement>("#custom-name")?.focus();
  }
  function customize(
    theme: (typeof THEME_CARDS)[number],
    invoker: HTMLElement,
  ) {
    const probe = document.createElement("div");
    probe.dataset.theme = theme.id;
    probe.style.cssText =
      "position:fixed;visibility:hidden;pointer-events:none";
    document.body.append(probe);
    try {
      void open(
        {
          id: services.themes.createId(),
          name: `${theme.name.slice(0, 35)} copy`,
          ...readColors(probe),
        },
        invoker,
        true,
      );
    } finally {
      probe.remove();
    }
  }
  function duplicate(theme: CustomTheme, invoker?: HTMLElement) {
    void open(
      duplicateCustomTheme(
        theme,
        () => crypto.randomUUID(),
        themes.map((t) => t.id),
      ),
      invoker,
      true,
    );
  }
  function closeMenu(focus = true) {
    menuId = null;
    if (focus && menuTrigger?.isConnected) menuTrigger.focus();
  }
  async function toggleMenu(theme: CustomTheme, trigger: HTMLButtonElement) {
    if (menuId === theme.id) {
      closeMenu();
      return;
    }
    menuTrigger = trigger;
    menuId = theme.id;
    await tick();
    if (menuId === theme.id)
      section.querySelector<HTMLButtonElement>('[role="menu"] button')?.focus();
  }
  function menuKey(event: KeyboardEvent) {
    if (event.key === "Escape" && menuId) {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      return;
    }
    if (!menuId) return;
    const items = [
      ...section.querySelectorAll<HTMLButtonElement>('[role="menu"] button'),
    ];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      items[
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : items.length - 1)) %
              items.length
      ]?.focus();
    } else if (event.key === "Tab") closeMenu(false);
  }
  function restoreInvoker(invoker: HTMLElement) {
    if (active && alive && invoker.isConnected) {
      const scroll = section.closest<HTMLElement>(".settings-content");
      if (scroll) scroll.scrollTop = returnScroll;
      invoker.focus({ preventScroll: true });
    }
  }
  function cancel(focus = true) {
    draft = null;
    editingId = null;
    pendingExit = null;
    conflict = false;
    const revision = ++focusRevision;
    if (focus && active && alive) {
      void tick().then(() => {
        if (revision !== focusRevision) return;
        const invoker =
          returnFocus?.isConnected && section.contains(returnFocus)
            ? returnFocus
            : (section.querySelector<HTMLElement>(
                `[data-theme-card="${returnInvoker?.themeId ?? ""}"] ${returnInvoker?.kind === "more" ? ".theme-more" : ".pick-card__edit"}`,
              ) ??
              section.querySelector<HTMLElement>("#custom-create") ??
              section.querySelector<HTMLElement>("#theme-search"));
        if (invoker) restoreInvoker(invoker);
        else onFocusReturn?.();
      });
    }
  }

  async function save() {
    if (!draft || !draft.name.trim()) return;
    const value = themeDraft(draft);
    if (
      value &&
      (await run(
        () => services.themes.save(value, editingId),
        `Saved ${value.name}.`,
      ))
    ) {
      query = "";
      library = "custom";
      const next = pendingExit;
      cancel(!next);
      next?.();
    }
  }
  async function remove(theme: CustomTheme) {
    closeMenu(false);
    if (
      await run(
        () => services.themes.remove(theme.id),
        `Deleted ${theme.name}.`,
      )
    ) {
      deletedName = theme.name;
      deleteTarget = null;
      undo = true;
      clearTimeout(undoTimer);
      undoTimer = setTimeout(() => {
        undo = false;
      }, 7000);
      await tick();
      if (active && alive)
        section.querySelector<HTMLButtonElement>("#custom-theme-undo")?.focus();
    }
  }
  async function requestDelete(theme: CustomTheme) {
    closeMenu(false);
    if (theme.id === snapshot.settings.theme) {
      deleteTarget = theme;
      await tick();
      if (alive && deleteTarget.id === theme.id)
        section
          .querySelector<HTMLButtonElement>(".theme-exit-guard .btn")
          ?.focus();
    } else void remove(theme);
  }
  async function importFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const selectedFile = input.files?.[0];
    input.value = "";
    if (selectedFile)
      await run(async () => {
        if (selectedFile.size > CUSTOM_THEME_IMPORT_MAX_BYTES)
          throw new Error(
            "Import failed: the file is larger than 256 KiB. Nothing was changed.",
          );
        const result = await services.themes.import(await selectedFile.text());
        if (!alive) return;
        cancel(false);
        status = `Imported ${String(result.importedCount)} theme${result.importedCount === 1 ? "" : "s"}.${result.remappedCount ? ` ${String(result.remappedCount)} ID${result.remappedCount === 1 ? "" : "s"} remapped.` : ""}${result.warningCount ? ` ${String(result.warningCount)} contrast warning${result.warningCount === 1 ? "" : "s"}.` : ""}`;
      });
  }
  function exportFile(id?: string) {
    try {
      const url = URL.createObjectURL(
        new Blob(
          [id ? services.themes.exportOne(id) : services.themes.export()],
          { type: "application/json" },
        ),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "lightfield-custom-themes.json";
      link.click();
      downloads.set(
        url,
        setTimeout(() => {
          URL.revokeObjectURL(url);
          downloads.delete(url);
        }, 0),
      );
      status = id ? "Theme exported." : "Themes exported.";
    } catch (error) {
      status =
        error instanceof Error ? error.message : "Couldn’t export themes.";
    }
  }
  function toneKey(event: KeyboardEvent, index: number) {
    const tones = ["auto", "dark", "light"] as const;
    let next: number;
    if (event.key === "ArrowRight" || event.key === "ArrowDown")
      next = (index + 1) % 3;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = (index + 2) % 3;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = 2;
    else return;
    event.preventDefault();
    const tone = tones[next];
    if (!tone) return;
    patch({ uiTone: tone });
    section.querySelector<HTMLButtonElement>("#modal-tone-" + tone)?.focus();
  }
</script>

<svelte:window
  onpointerdown={(event: PointerEvent) => {
    if (
      menuId &&
      event.target instanceof Element &&
      !event.target.closest('[role="menu"], .theme-more')
    )
      closeMenu(false);
  }}
/>
<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role (Source section/tabpanel semantics are a parity asset.) -->
<section
  onkeydown={menuKey}
  bind:this={section}
  class="group modal__panel"
  class:is-active={active}
  data-settings-category="appearance"
  id="panel-themes"
  role="tabpanel"
  tabindex="-1"
  aria-labelledby="tab-btn-themes"
  hidden={!active}
>
  <div class="panel__header">
    <h3 class="panel__title">Themes &amp; Colors</h3>
  </div>
  {#if !draft}
    {#each preferences as preference (preference.key)}
      <div class="control">
        <div
          class="control__row"
          class:presentation-row={preference.key === "settingsPresentation"}
        >
          <span class="control__label" id={preference.id}
            >{preference.label}</span
          >
          <div
            class="dock__segmented segmented"
            role="radiogroup"
            aria-labelledby={preference.id}
          >
            {#each preference.values as [value, label] (value)}<label
                class="segmented-item"
                ><input
                  type="radio"
                  name={preference.key}
                  {value}
                  data-setting={preference.key}
                  checked={snapshot.settings[preference.key] === value}
                  onchange={() => {
                    patch({ [preference.key]: value });
                  }}
                /><span class="dock__seg-btn segmented-btn">{label}</span
                ></label
              >{/each}
          </div>
        </div>
      </div>
    {/each}
    <div class="control">
      <div class="control__row">
        <span class="control__label" id="effect-shortcut-label"
          >Effect shortcut</span
        ><label class="switch toggle"
          ><input
            type="checkbox"
            data-setting="showEffectShortcut"
            aria-labelledby="effect-shortcut-label"
            checked={snapshot.settings.showEffectShortcut}
            onchange={(e) => {
              patch({ showEffectShortcut: e.currentTarget.checked });
            }}
          /><span class="toggle__track"
            ><span class="toggle__thumb"></span></span
          ></label
        >
      </div>
    </div>
    <div class="control">
      <div class="control__row">
        <span class="control__label">UI Glass Tone</span>
        <div
          class="dock__segmented segmented"
          role="radiogroup"
          aria-label="UI tone"
        >
          {#each ["auto", "dark", "light"] as tone, index (tone)}<button
              class="dock__seg-btn segmented-btn"
              class:is-active={snapshot.settings.uiTone === tone}
              id={"modal-tone-" + tone}
              data-ui-tone={tone}
              type="button"
              role="radio"
              aria-checked={snapshot.settings.uiTone === tone}
              tabindex={snapshot.settings.uiTone === tone ? 0 : -1}
              onclick={() => {
                patch({ uiTone: tone as "auto" | "dark" | "light" });
              }}
              onkeydown={(e: KeyboardEvent) => {
                toneKey(e, index);
              }}>{tone[0]?.toUpperCase()}{tone.slice(1)}</button
            >{/each}
        </div>
      </div>
    </div>
    <div class="drawer__range-group">
      <div class="drawer__row">
        <span class="drawer__control-label">Glass Blur Intensity</span><span
          class="drawer__range-val"
          id="modal-blur-val">{snapshot.settings.glassBlur}px</span
        >
      </div>
      <div class="drawer__range-row">
        <input
          class="drawer__range"
          id="modal-blur-slider"
          type="range"
          min="8"
          max="44"
          step="2"
          value={snapshot.settings.glassBlur}
          aria-label="Glass backdrop blur"
          oninput={(e) => {
            patch({ glassBlur: Number(e.currentTarget.value) });
          }}
        />
      </div>
    </div>
    <div class="control control--stacked">
      <div class="control__row">
        <span class="control__label">Colorway Themes</span>
      </div>
      <label class="visually-hidden" for="theme-search">Filter themes</label>
      <div class="filter-row">
        <input
          bind:this={search}
          bind:value={query}
          class="settings-filter"
          id="theme-search"
          type="search"
          placeholder={library === "presets"
            ? "Filter 36 themes…"
            : "Filter custom themes…"}
          autocomplete="off"
          spellcheck="false"
          maxlength="60"
        /><button
          class="quiet-action"
          id="theme-filter-clear"
          type="button"
          hidden={!query.trim()}
          onclick={() => {
            query = "";
            search?.focus();
          }}>Clear</button
        >
      </div>
      <p
        class="filter-status"
        id="theme-filter-status"
        role="status"
        aria-live="polite"
      >
        {!query.trim()
          ? ""
          : visibleCount === 0
            ? "No themes found."
            : `${String(visibleCount)} theme${visibleCount === 1 ? "" : "s"} found.`}
      </p>
      <div class="theme-library-tabs" role="tablist" aria-label="Theme library">
        {#each ["presets", "custom"] as tab (tab)}
          <button
            type="button"
            role="tab"
            aria-selected={library === tab}
            tabindex={library === tab ? 0 : -1}
            aria-controls="theme-picker"
            id={`theme-tab-${tab}`}
            onclick={() => {
              library = tab as "presets" | "custom";
              query = "";
              closeMenu(false);
            }}
            onkeydown={(event) => {
              if (
                ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              ) {
                event.preventDefault();
                library =
                  event.key === "Home"
                    ? "presets"
                    : event.key === "End"
                      ? "custom"
                      : library === "presets"
                        ? "custom"
                        : "presets";
                section
                  .querySelector<HTMLButtonElement>(`#theme-tab-${library}`)
                  ?.focus();
              }
            }}>{tab === "presets" ? "Presets" : "Custom"}</button
          >
        {/each}
      </div>
      {#if library === "custom"}
        <div class="custom-theme-actions">
          <button
            class="btn"
            id="custom-create"
            type="button"
            disabled={busy}
            onclick={(event) => open(undefined, event.currentTarget)}
            >New theme</button
          >
          <button
            class="btn btn--ghost"
            id="custom-import"
            type="button"
            disabled={busy}
            onclick={() => {
              file.click();
            }}>Import</button
          >
          <button
            class="btn btn--ghost"
            id="custom-export"
            type="button"
            disabled={busy}
            onclick={() => {
              exportFile();
            }}>Export all</button
          >
        </div>
      {/if}
      {#if deleteTarget}
        <div class="theme-exit-guard" role="alert">
          <span>Delete {deleteTarget.name}? Midnight will become selected.</span
          >
          <button
            class="btn"
            type="button"
            disabled={busy}
            onclick={() => deleteTarget && remove(deleteTarget)}>Delete</button
          >
          <button
            class="btn btn--ghost"
            type="button"
            disabled={busy}
            onclick={() => {
              deleteTarget = null;
            }}>Cancel</button
          >
        </div>
      {/if}
      <div
        class="picker picker--themes theme-grid"
        id="theme-picker"
        role="tabpanel"
        aria-labelledby={`theme-tab-${library}`}
      >
        {#each library === "presets" ? THEME_CARDS : themes as theme (theme.id)}
          <div
            class="theme-library-card pick-card"
            class:is-selected={snapshot.settings.theme === theme.id}
            data-theme-card={theme.id}
            data-custom-theme={library === "custom" ? theme.id : undefined}
            hidden={!themeMatchesSearch(query, theme.name, theme.id)}
          >
            <button
              class="theme-card-select"
              type="button"
              aria-label={`Select ${theme.name}`}
              aria-pressed={snapshot.settings.theme === theme.id}
              disabled={busy}
              onclick={() => {
                patch({ theme: theme.id });
              }}
            >
              <span class="pick-card__body">
                <span class="pick-card__swatches">
                  {#if "paper" in theme}
                    {#each customThemeSwatches(theme) as color, index (index)}<i
                        style={"--preview-runtime-swatch:" + color}
                      ></i>{/each}
                  {:else}<i></i><i></i><i></i><i></i>{/if}
                </span>
                <span class="pick-card__info"
                  ><span class="pick-card__name">{theme.name}</span><span
                    class="theme-card__tone-badge"
                    >{"paper" in theme
                      ? themeTone(theme.paper)
                      : theme.tone}</span
                  ></span
                >
              </span>
            </button>
            <div class="theme-card-actions">
              {#if "paper" in theme}
                <button
                  class="btn btn--ghost pick-card__edit"
                  type="button"
                  aria-label={`Edit ${theme.name}`}
                  disabled={busy}
                  onclick={(event) => open(theme, event.currentTarget)}
                  >Edit</button
                >
                <button
                  class="btn btn--ghost theme-more"
                  type="button"
                  aria-label={`More actions for ${theme.name}`}
                  aria-haspopup="menu"
                  aria-expanded={menuId === theme.id}
                  disabled={busy}
                  onclick={(event) => toggleMenu(theme, event.currentTarget)}
                  >⋯</button
                >
              {:else}
                <button
                  class="btn btn--ghost pick-card__edit"
                  type="button"
                  aria-label={`Customize ${theme.name}`}
                  disabled={busy}
                  onclick={(event) => {
                    customize(theme, event.currentTarget);
                  }}>Customize</button
                >
              {/if}
            </div>
            {#if menuId === theme.id && "paper" in theme}
              <div
                class="theme-card-menu"
                role="menu"
                aria-label={`Actions for ${theme.name}`}
              >
                <button
                  type="button"
                  role="menuitem"
                  onclick={() => open(theme, menuTrigger ?? undefined)}
                  >Rename</button
                >
                <button
                  type="button"
                  role="menuitem"
                  onclick={() => {
                    duplicate(theme, menuTrigger ?? undefined);
                  }}>Duplicate</button
                >
                <button
                  type="button"
                  role="menuitem"
                  onclick={() => {
                    closeMenu();
                    exportFile(theme.id);
                  }}>Export</button
                >
                <button
                  type="button"
                  role="menuitem"
                  onclick={() => {
                    void requestDelete(theme);
                  }}>Delete</button
                >
              </div>
            {/if}
          </div>
        {/each}
      </div>
      {#if library === "custom" && !themes.length}<p class="control__hint">
          No custom themes.
        </p>{/if}
    </div>
  {:else}
    <button
      class="btn btn--ghost"
      id="custom-back"
      type="button"
      disabled={busy}
      onclick={() => {
        if (
          requestExit(() => {
            cancel();
          })
        )
          cancel();
      }}>← Back</button
    >
    <ThemeEditor
      {draft}
      editing={editingId !== null}
      {busy}
      onchange={change}
      onsave={save}
      oncancel={() => {
        if (
          requestExit(() => {
            cancel();
          })
        )
          cancel();
      }}
    />
    {#if pendingExit}
      <div class="theme-exit-guard" role="alert">
        <span>Save your changes?</span>
        <button
          class="btn"
          id="custom-exit-save"
          type="button"
          disabled={busy || !themeDraft(draft) || !draft.name.trim()}
          onclick={save}>Save</button
        >
        <button
          class="btn btn--ghost"
          id="custom-discard"
          type="button"
          disabled={busy}
          onclick={() => {
            const next = pendingExit;
            cancel(false);
            next?.();
          }}>Discard</button
        >
        <button
          class="btn btn--ghost"
          id="custom-keep-editing"
          type="button"
          disabled={busy}
          onclick={() => {
            pendingExit = null;
            section.querySelector<HTMLInputElement>("#custom-name")?.focus();
          }}>Keep editing</button
        >
      </div>
    {/if}
    {#if editingId && !themes.some((theme) => theme.id === editingId)}
      <button
        class="btn"
        type="button"
        disabled={busy || !themeDraft(draft) || !draft.name.trim()}
        onclick={() => {
          if (!draft) return;
          draft = { ...draft, id: services.themes.createId() };
          editingId = null;
          void save();
        }}>Save as new</button
      >
    {/if}
    {#if conflict}<button
        class="btn btn--ghost"
        type="button"
        disabled={busy}
        onclick={() => {
          if (
            requestExit(() => {
              cancel();
            })
          )
            cancel();
        }}>Discard to reload</button
      >{/if}
  {/if}
  <input
    bind:this={file}
    id="custom-import-file"
    type="file"
    accept=".json,application/json"
    hidden
    onchange={importFile}
  />
  <div
    class="inline-status"
    id="custom-theme-status"
    role="status"
    aria-live="polite"
  >
    <span id="custom-theme-status-text">{status}</span>
    <button
      class="btn btn--ghost"
      id="custom-theme-undo"
      type="button"
      hidden={!undo}
      disabled={busy}
      onclick={async () => {
        if (
          await run(() => services.themes.undo(), `Restored ${deletedName}.`)
        ) {
          undo = false;
          clearTimeout(undoTimer);
        }
      }}>Undo {deletedName}</button
    >
  </div>
</section>
