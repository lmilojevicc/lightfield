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
  import {
    createCustomThemePreviewState,
    customThemePreviewTransition,
  } from "../../domain/themes/custom-theme-workflow";
  const {
    services,
    snapshot,
    active = true,
    sessionOpen = true,
    onThemePreview,
    readThemeColors,
    onFocusReturn,
    onEditorStateChange,
  }: {
    services: AppServices;
    snapshot: SettingsSnapshot;
    active?: boolean;
    sessionOpen?: boolean;
    onThemePreview: (draft: CustomTheme | undefined) => void;
    readThemeColors: () => Pick<CustomTheme, "paper" | "ink" | "accent">;
    onFocusReturn?: () => void;
    onEditorStateChange?: (open: boolean, busy: boolean) => void;
  } = $props();
  /** Return whether an editor consumed the close gesture (including an in-flight save). */
  export function isCloseBlocked(): boolean {
    return busy;
  }
  export function cancelEditor(): boolean {
    if (!draft) return false;
    if (!busy) cancel();
    return true;
  }
  $effect(() => onEditorStateChange?.(draft !== null, busy));
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
  let search: HTMLInputElement;
  let file: HTMLInputElement;
  let returnFocus: HTMLElement | null = null;
  let preview = createCustomThemePreviewState(null);
  let selected: string | undefined;
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
    THEME_CARDS.filter((t) => themeMatchesSearch(query, t.name, t.id)).length +
      themes.filter((t) => themeMatchesSearch(query, t.name, t.id)).length,
  );
  onMount(() => {
    const stop = services.themes.subscribe((value) => {
      if (draft && !busy && JSON.stringify(value) !== JSON.stringify(themes))
        cancel(false);
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
      onThemePreview(undefined);
    };
  });
  $effect(() => {
    const next = snapshot.durable.theme;
    if (next !== selected) {
      selected = next;
      preview = customThemePreviewTransition(preview, {
        type: "select",
        theme: themes.find((t) => t.id === next) ?? null,
      });
      if (draft && !busy) cancel(false);
    }
  });
  $effect(() => {
    if (!sessionOpen && draft && !busy) cancel(false);
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
    const valid = themeDraft(value);
    preview = customThemePreviewTransition(
      preview,
      valid ? { type: "preview", theme: valid } : { type: "invalid-draft" },
    );
    if (valid) onThemePreview(valid);
  }
  async function open(theme?: CustomTheme, invoker?: HTMLElement) {
    const target = invoker ?? document.activeElement;
    returnFocus =
      target instanceof HTMLElement && section.contains(target)
        ? target
        : section.querySelector<HTMLElement>("#custom-create");
    editingId = theme?.id ?? null;
    change(
      theme
        ? { ...theme }
        : {
            id: services.themes.createId(),
            name: "",
            ...readThemeColors(),
          },
    );
    await tick();
    section.querySelector<HTMLInputElement>("#custom-name")?.focus();
  }
  function restoreInvoker(invoker: HTMLElement) {
    if (active && alive && invoker.isConnected) invoker.focus();
  }
  function cancel(focus = true) {
    preview = customThemePreviewTransition(preview, { type: "cancel" });
    draft = null;
    editingId = null;
    onThemePreview(undefined);
    if (focus && active && alive) {
      const invoker =
        returnFocus?.isConnected && section.contains(returnFocus)
          ? returnFocus
          : section.querySelector<HTMLElement>("#custom-create");
      if (invoker)
        void tick().then(() => {
          restoreInvoker(invoker);
        });
      else onFocusReturn?.();
    }
  }
  async function save() {
    if (!draft) return;
    const value = themeDraft(draft);
    if (
      value &&
      (await run(
        () => services.themes.save(value, editingId),
        `Saved and selected ${value.name}.`,
      ))
    ) {
      query = "";
      cancel();
    }
  }
  async function remove() {
    const id = editingId;
    if (id && (await run(() => services.themes.remove(id), "Theme deleted."))) {
      undo = true;
      clearTimeout(undoTimer);
      const deletionStatus = status;
      undoTimer = setTimeout(() => {
        undo = false;
        if (status === deletionStatus) status = "";
      }, 7000);
      cancel(false);
      await tick();
      if (active)
        section.querySelector<HTMLButtonElement>("#custom-theme-undo")?.focus();
    }
  }
  async function duplicate() {
    const value = draft && themeDraft(draft);
    if (value && (await run(() => services.themes.duplicate(value)))) cancel();
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
  function exportFile() {
    try {
      const url = URL.createObjectURL(
        new Blob([services.themes.export()], { type: "application/json" }),
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
      status = `Exported ${String(themes.length)} custom ${themes.length === 1 ? "theme" : "themes"}.`;
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
  onkeydown={(e: KeyboardEvent) => {
    if (!e.defaultPrevented && active && draft && e.key === "Escape" && !busy) {
      e.preventDefault();
      e.stopImmediatePropagation();
      cancel();
    }
  }}
/>
<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role (Source section/tabpanel semantics are a parity asset.) -->
<section
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
  {#each preferences as preference (preference.key)}
    <div class="control">
      <div
        class="control__row"
        class:presentation-row={preference.key === "settingsPresentation"}
      >
        <span class="control__label" id={preference.id}>{preference.label}</span
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
              /><span class="dock__seg-btn segmented-btn">{label}</span></label
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
        /><span class="toggle__track"><span class="toggle__thumb"></span></span
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
        placeholder="Filter 36 themes…"
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
          search.focus();
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
    <div
      class="picker picker--themes theme-grid"
      id="theme-picker"
      role="radiogroup"
      aria-label="Theme"
    >
      {#each THEME_CARDS as theme (theme.id)}<label
          class="pick-card"
          data-theme-card={theme.id}
          style:display={themeMatchesSearch(query, theme.name, theme.id)
            ? ""
            : "none"}
          ><input
            type="radio"
            name="theme"
            value={theme.id}
            data-setting="theme"
            checked={snapshot.settings.theme === theme.id}
            disabled={busy}
            onchange={() => {
              cancel(false);
              patch({ theme: theme.id });
            }}
          /><span class="pick-card__body"
            ><span class="pick-card__swatches"
              ><i></i><i></i><i></i><i></i></span
            ><span class="pick-card__info"
              ><span class="pick-card__name">{theme.name}</span><span
                class="theme-card__tone-badge">{theme.tone}</span
              ></span
            ></span
          ></label
        >{/each}
      {#each themes as theme (theme.id)}<div
          class="custom-theme-option"
          data-custom-theme={theme.id}
          data-theme-card={theme.id}
          style:display={themeMatchesSearch(query, theme.name, theme.id)
            ? ""
            : "none"}
        >
          <label class="pick-card pick-card__select"
            ><input
              type="radio"
              name="theme"
              value={theme.id}
              data-setting="theme"
              checked={snapshot.settings.theme === theme.id}
              disabled={busy}
              onchange={() => {
                cancel(false);
                patch({ theme: theme.id });
              }}
            /><span class="pick-card__body"
              ><span class="pick-card__swatches"
                >{#each customThemeSwatches(theme) as color, swatchIndex (swatchIndex)}<i
                    style={"--preview-runtime-swatch:" + color}
                  ></i>{/each}</span
              ><span class="pick-card__info"
                ><span class="pick-card__name">{theme.name}</span><span
                  class="theme-card__tone-badge">{themeTone(theme.paper)}</span
                ></span
              ></span
            ></label
          ><button
            class="btn btn--ghost pick-card__edit"
            type="button"
            aria-label={`Edit ${theme.name} theme`}
            disabled={busy}
            onclick={() => open(theme)}>Edit</button
          >
        </div>{/each}
    </div>
  </div>
  <div
    class="control custom-theme-group"
    id="custom-theme-group"
    role="group"
    aria-busy={busy}
    aria-labelledby="custom-theme-group-label"
    aria-describedby="custom-theme-hint custom-theme-status-text"
  >
    <div class="control__row">
      <span class="control__label" id="custom-theme-group-label"
        >Custom Theme</span
      ><button
        class="btn btn--ghost"
        id="custom-create"
        hidden={draft !== null}
        type="button"
        disabled={busy}
        onclick={(event: MouseEvent & { currentTarget: HTMLButtonElement }) =>
          open(undefined, event.currentTarget)}>Create theme</button
      >
    </div>
    <div class="custom-theme-actions">
      <input
        bind:this={file}
        id="custom-import-file"
        type="file"
        accept=".json,application/json"
        hidden
        onchange={importFile}
      /><button
        class="btn btn--ghost"
        id="custom-import"
        type="button"
        disabled={busy}
        onclick={() => {
          file.click();
        }}>Import</button
      ><button
        class="btn btn--ghost"
        id="custom-export"
        type="button"
        disabled={busy}
        onclick={exportFile}>Export</button
      >
    </div>
    {#if draft}<ThemeEditor
        {draft}
        editing={editingId !== null}
        {busy}
        onchange={change}
        onsave={save}
        oncancel={() => {
          cancel();
        }}
        onduplicate={duplicate}
        ondelete={remove}
      />{/if}
    <p class="control__hint" id="custom-theme-hint">
      Create from your current colors. Import and export theme backups.
    </p>
    <div
      class="inline-status"
      id="custom-theme-status"
      role="status"
      aria-live="polite"
    >
      <span id="custom-theme-status-text">{status}</span><button
        class="btn btn--ghost"
        id="custom-theme-undo"
        type="button"
        hidden={!undo}
        disabled={busy}
        onclick={async () => {
          if (await run(() => services.themes.undo())) {
            undo = false;
            clearTimeout(undoTimer);
          }
        }}>Undo delete</button
      >
    </div>
  </div>
</section>
