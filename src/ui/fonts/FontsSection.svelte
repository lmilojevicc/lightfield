<script lang="ts">
  import { onMount, tick } from "svelte";
  import type {
    AppServices,
    SettingsSnapshot,
    FontSnapshot,
    FontPreview,
  } from "../../services/contracts";
  import {
    FONT_PRESETS,
    FONT_FAMILIES,
    GOOGLE_FONT_SUGGESTIONS,
    fontRoleTokens,
    resolveFontFamily,
    fontPreset,
  } from "../../domain/fonts/font-pairings";
  import { createFontPreviewOwner } from "./font-preview-owner";
  const {
    services,
    snapshot,
    active = true,
    onRequestFontConsent,
    onFocusReturn,
  }: {
    services: AppServices;
    snapshot: SettingsSnapshot;
    active?: boolean;
    /** Starts permission request synchronously within the initiating gesture. */
    onRequestFontConsent?: () => boolean | Promise<boolean>;
    onFocusReturn?: () => void;
  } = $props();
  let section: HTMLElement;
  let openButton: HTMLButtonElement;
  let opened = $state(false);
  let display = $state("");
  let body = $state("");
  let fontState = $state<FontSnapshot>({
    state: "idle",
    error: null,
    display: null,
    body: null,
  });
  let preview = $state<FontPreview | undefined>();
  let loading = $state(false);
  let saving = $state(false);
  let error = $state("");
  let deferred = false;
  let request = 0;
  let alive = true;
  let awaitingPreview = false;
  const owner = createFontPreviewOwner({
    preview: (display, body, signal) =>
      services.fonts.preview(display, body, signal),
  });
  const specimenStyle = $derived.by(() => {
    const left = preview?.display ?? fontState.display;
    const right = preview?.body ?? fontState.body;
    return left && right
      ? Object.entries(
          fontRoleTokens(
            left,
            right,
            !preview && snapshot.settings.fonts !== "custom"
              ? fontPreset(snapshot.settings.fonts).displayWeight
              : undefined,
          ),
        )
          .map(([key, value]) => `${key}:${value}`)
          .join(";")
      : "";
  });
  onMount(() => {
    const stop = services.fonts.subscribe((value) => {
      fontState = value;
    });
    const activity = services.activity.subscribe((isActive) => {
      if (!isActive && loading && awaitingPreview && !saving) {
        request++;
        loading = false;
        deferred = true;
        owner.clear();
        preview = undefined;
      } else if (isActive && deferred && opened) {
        deferred = false;
        void load(false);
      }
    });
    return () => {
      alive = false;
      request++;
      stop();
      activity();
      owner.clear();
      services.fonts.cancel();
    };
  });
  $effect(() => {
    if (!active && opened && !saving) cancel(false);
  });
  async function open() {
    const values = [
      snapshot.settings.customDisplayFont,
      snapshot.settings.customBodyFont,
    ];
    display = values[0] ?? "";
    body = values[1] ?? "";
    opened = true;
    error = "";
    await tick();
    section.querySelector<HTMLInputElement>("#custom-display-font")?.focus();
  }
  function edit(role: "display" | "body", value: string) {
    request++;
    owner.clear();
    preview = undefined;
    loading = false;
    deferred = false;
    error = "";
    if (role === "display") display = value;
    else body = value;
  }
  function cancel(focus = true) {
    request++;
    owner.clear();
    services.fonts.cancel();
    preview = undefined;
    loading = false;
    deferred = false;
    error = "";
    opened = false;
    if (focus && active && alive) {
      if (openButton.isConnected) openButton.focus();
      else onFocusReturn?.();
    }
  }
  function authorization(): boolean | Promise<boolean> {
    const remote =
      resolveFontFamily(display, "display").source === "google" ||
      resolveFontFamily(body, "body").source === "google";
    return remote ? (onRequestFontConsent?.() ?? false) : true;
  }
  async function load(authorize = true) {
    if (!opened || saving || !alive) return;
    let grant: boolean | Promise<boolean>;
    try {
      grant = authorize ? authorization() : true;
    } catch (reason) {
      error = reason instanceof Error ? reason.message : "Couldn’t load fonts.";
      return;
    }
    const ticket = ++request;
    loading = true;
    error = "";
    owner.clear();
    preview = undefined;
    try {
      if (!(await grant))
        throw new Error(
          "Google Fonts permission is required. Included and system fonts work offline.",
        );
      if (ticket !== request) return;
      awaitingPreview = true;
      const result = await owner.load(display, body);
      if (ticket === request) preview = result;
    } catch (reason) {
      if (ticket === request)
        error =
          reason instanceof Error ? reason.message : "Couldn’t load fonts.";
    } finally {
      if (ticket === request) {
        loading = false;
        awaitingPreview = false;
      }
    }
  }
  async function apply() {
    if (saving || !preview || !opened) return;
    const invoker = document.activeElement;
    const ticket = request;
    const ownsRequest = () => alive && ticket === request && opened;
    let grant: boolean | Promise<boolean>;
    try {
      grant = authorization();
    } catch (reason) {
      error = reason instanceof Error ? reason.message : "Couldn’t load fonts.";
      return;
    }
    saving = true;
    error = "";
    try {
      if (!(await grant))
        throw new Error(
          "Google Fonts permission is required. Included and system fonts work offline.",
        );
      if (!ownsRequest()) return;
      await services.fonts.save(display, body);
      if (ownsRequest()) cancel(active && document.activeElement === invoker);
    } catch (reason) {
      error = reason instanceof Error ? reason.message : "Couldn’t save fonts.";
    } finally {
      saving = false;
    }
  }
  async function preset(id: (typeof FONT_PRESETS)[number]["id"]) {
    if (saving) return;
    cancel(false);
    saving = true;
    try {
      await services.fonts.preset({
        fonts: id,
        customDisplayFont: snapshot.settings.customDisplayFont,
        customBodyFont: snapshot.settings.customBodyFont,
      });
    } catch (reason) {
      error = reason instanceof Error ? reason.message : "Couldn’t save fonts.";
    } finally {
      saving = false;
    }
  }
  function cardKey(event: KeyboardEvent, index: number) {
    let next: number;
    if (event.key === "ArrowRight" || event.key === "ArrowDown")
      next = (index + 1) % FONT_PRESETS.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = (index + FONT_PRESETS.length - 1) % FONT_PRESETS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = FONT_PRESETS.length - 1;
    else return;
    event.preventDefault();
    const value = FONT_PRESETS[next];
    if (!value) return;
    void preset(value.id);
    section
      .querySelector<HTMLButtonElement>(`[data-font-id="${value.id}"]`)
      ?.focus();
  }
</script>

<svelte:window
  onkeydown={(e: KeyboardEvent) => {
    if (active && opened && e.key === "Escape" && !saving) {
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
  data-settings-category="fonts"
  id="panel-fonts"
  role="tabpanel"
  tabindex="-1"
  aria-labelledby="tab-btn-fonts"
  hidden={!active}
>
  <div class="panel__header">
    <h3 class="panel__title">Typography &amp; Font Pairings</h3>
  </div>
  <div
    class="font-grid"
    id="modal-font-grid"
    role="radiogroup"
    aria-label="Font pairings"
  >
    {#each FONT_PRESETS as value, index (value.id)}<button
        type="button"
        class="font-pairing-card"
        class:is-active={snapshot.settings.fonts === value.id}
        data-font-id={value.id}
        role="radio"
        aria-checked={snapshot.settings.fonts === value.id}
        tabindex={snapshot.settings.fonts === value.id ||
        (snapshot.settings.fonts === "custom" && index === 0)
          ? 0
          : -1}
        disabled={saving}
        onclick={() => preset(value.id)}
        onkeydown={(e: KeyboardEvent) => {
          cardKey(e, index);
        }}
        ><span class="font-card__header"
          ><span class="font-card__name">{value.label}</span><span
            class="font-card__badge">{value.badge}</span
          ></span
        ><span class="font-card__sub"
          >{value.display.name === "system-ui"
            ? "System Sans"
            : value.display.name}</span
        ><span
          class="font-card__preview-sample"
          style:font-family={value.display.stack}
          style:font-weight={value.displayWeight}>12:00 Preview</span
        ></button
      >{/each}
  </div>
  <div class="panel__subgroup">
    <div
      class="specimen-card"
      id="specimen-card"
      role="group"
      aria-label="Font specimen"
      style={specimenStyle}
    >
      <div class="specimen-clock" id="specimen-clock">12:00:48</div>
      <div class="specimen-date" id="specimen-date">
        Monday, October 28 · 18° Partly Cloudy
      </div>
      <p class="specimen-text" id="specimen-text">
        The quick brown fox jumps over the lazy dog. 0123456789. Designed for
        serenity and spatial minimalism in browser start pages.
      </p>
      <p
        class="specimen-caption"
        id="specimen-draft-note"
        role="status"
        aria-live="polite"
        hidden={!preview}
      >
        Draft preview · not applied
      </p>
    </div>
  </div>
  <div class="control typography-control">
    <p
      class="control__hint"
      id="current-font-status"
      role="status"
      aria-live="polite"
    >
      {snapshot.settings.fonts !== "custom"
        ? `${fontPreset(snapshot.settings.fonts).label} · works offline`
        : fontState.state === "loading"
          ? "Loading saved custom fonts…"
          : fontState.state === "error"
            ? "Saved custom fonts unavailable. Stable fallback remains. Edit custom fonts to preview and retry; saved names are unchanged."
            : fontState.state === "ready"
              ? "Custom fonts ready."
              : ""}{!opened ? error : ""}
    </p>
    {#if fontState.state === "error" && !opened}<button
        class="btn btn--ghost"
        type="button"
        onclick={() => {
          void services.fonts.retry().catch((reason: unknown) => {
            error =
              reason instanceof Error ? reason.message : "Couldn’t load fonts.";
          });
        }}>Retry</button
      >{/if}
    <button
      bind:this={openButton}
      class="btn btn--ghost"
      id="custom-font-open"
      type="button"
      aria-expanded={opened}
      aria-controls="custom-font-controls"
      disabled={saving}
      hidden={opened}
      onclick={() => {
        if (opened) cancel();
        else void open();
      }}
      >{snapshot.settings.fonts === "custom"
        ? "Edit custom fonts"
        : "Custom fonts"}</button
    >
    <div id="custom-font-controls" hidden={!opened}>
      <div class="custom-font__grid">
        <label class="custom-font__field" for="custom-display-font"
          >Display (clock)</label
        ><input
          class="control__input"
          id="custom-display-font"
          type="text"
          list="font-suggestions"
          autocomplete="off"
          spellcheck="false"
          maxlength="60"
          aria-describedby="display-font-status"
          value={display}
          disabled={saving}
          oninput={(e) => {
            edit("display", e.currentTarget.value);
          }}
        />
        <p
          class="control__hint"
          id="display-font-status"
          role="status"
          aria-live="polite"
        >
          {loading ? "Loading…" : preview ? "Ready" : ""}
        </p>
        <label class="custom-font__field" for="custom-body-font"
          >Interface (text)</label
        ><input
          class="control__input"
          id="custom-body-font"
          type="text"
          list="font-suggestions"
          autocomplete="off"
          spellcheck="false"
          maxlength="60"
          aria-describedby="body-font-status"
          value={body}
          disabled={saving}
          oninput={(e) => {
            edit("body", e.currentTarget.value);
          }}
        />
        <p
          class="control__hint"
          id="body-font-status"
          role="status"
          aria-live="polite"
        >
          {loading ? "Loading…" : preview ? "Ready" : ""}
        </p>
      </div>
      <datalist id="font-suggestions"
        >{#each [...FONT_FAMILIES.map((font) => font.name), ...GOOGLE_FONT_SUGGESTIONS] as name (name)}<option
            value={name}
            label={FONT_FAMILIES.find((font) => font.name === name)?.source ===
            "included"
              ? "Included"
              : FONT_FAMILIES.some((font) => font.name === name)
                ? "System"
                : "Google Fonts"}
          ></option>{/each}</datalist
      >
    </div>
    <div id="custom-font-draft-actions" hidden={!opened}>
      <p
        class="control__hint"
        id="custom-font-status"
        role="status"
        aria-live="polite"
      >
        {error ||
          (saving
            ? "Saving fonts…"
            : loading
              ? "Loading draft fonts. Current fonts remain in use."
              : preview
                ? "Draft preview ready. Apply fonts to save this pairing."
                : "Draft · preview before applying. Current fonts unchanged.")}
      </p>
      <p class="control__hint" id="font-network-help">
        Google families send names and weights to Google on preview. Included
        and system fonts work offline.
      </p>
      <div class="custom-font__actions">
        <button
          class="btn btn--ghost"
          id="custom-font-preview-button"
          type="button"
          aria-describedby="font-network-help"
          disabled={saving || loading}
          onclick={() => load()}>Preview fonts</button
        ><button
          class="btn"
          id="custom-font-apply"
          type="button"
          disabled={loading || !preview}
          aria-disabled={saving || loading || !preview}
          onclick={apply}>Apply fonts</button
        ><button
          class="btn btn--ghost"
          id="custom-font-cancel"
          type="button"
          disabled={saving}
          onclick={() => {
            cancel();
          }}>Cancel</button
        >
      </div>
    </div>
  </div>
</section>
