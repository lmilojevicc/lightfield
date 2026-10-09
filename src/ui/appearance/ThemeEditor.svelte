<script lang="ts">
  import type { CustomTheme } from "../../shared/theme";
  import {
    canonicalHexColor,
    analyzeCustomThemeContrast,
  } from "../../domain/themes/custom-themes";
  import { themeDraft, themeSpecimenStyle } from "./theme-draft";
  const {
    draft,
    editing,
    busy,
    onchange,
    onsave,
    oncancel,
  }: {
    draft: CustomTheme;
    editing: boolean;
    busy: boolean;
    onchange: (draft: CustomTheme) => void;
    onsave: () => void;
    oncancel: () => void;
  } = $props();
  let lastValid = $state<CustomTheme | undefined>();
  const valid = $derived(themeDraft(draft));
  $effect(() => {
    if (valid) lastValid = valid;
  });
  const fields = [
    { key: "paper", label: "Paper", hex: "Background" },
    { key: "ink", label: "Ink", hex: "Text" },
    { key: "accent", label: "Accent", hex: "Accent" },
  ] as const;
</script>

<div id="custom-theme-editor" class="custom-theme-editor">
  <h4 class="custom-theme-editor__heading" id="custom-editor-heading">
    {editing ? `Edit “${draft.name}”` : "Create theme"}
  </h4>
  <div class="custom-theme-fields">
    <label class="custom-theme-field" for="custom-name"
      ><span class="custom-theme-field__label">Name</span>
      <input
        class="control__input"
        id="custom-name"
        type="text"
        maxlength="40"
        autocomplete="off"
        spellcheck="false"
        placeholder="Theme name"
        value={draft.name}
        disabled={busy}
        oninput={(e) => {
          onchange({ ...draft, name: e.currentTarget.value });
        }}
      />
    </label>
    <div class="custom-theme-color-fields">
      {#each fields as field (field.key)}
        <div class="custom-color-field">
          <label class="custom-color-label" for={"custom-" + field.key}
            >{field.label}</label
          >
          <div class="custom-color-picker-wrap">
            <input
              type="color"
              id={"custom-" + field.key}
              value={canonicalHexColor(draft[field.key]) ??
                lastValid?.[field.key] ??
                "#000000"}
              aria-label={field.label + " color"}
              disabled={busy}
              oninput={(e) => {
                onchange({ ...draft, [field.key]: e.currentTarget.value });
              }}
            />
            <input
              class="custom-color-hex"
              id={"custom-" + field.key + "-hex"}
              type="text"
              maxlength="7"
              spellcheck="false"
              autocomplete="off"
              aria-label={field.hex + " hex color"}
              aria-invalid={!canonicalHexColor(draft[field.key])}
              value={draft[field.key]}
              disabled={busy}
              oninput={(e) => {
                onchange({ ...draft, [field.key]: e.currentTarget.value });
              }}
            />
          </div>
        </div>
      {/each}
    </div>
  </div>
  <div
    class="custom-theme-specimen"
    id="custom-draft-preview"
    aria-label="Theme draft preview"
    style={lastValid ? themeSpecimenStyle(lastValid) : ""}
  >
    <div class="custom-theme-specimen__clock">12:00</div>
    <div class="custom-theme-specimen__meta">Sample preview</div>
    <button
      class="primary-action custom-theme-specimen__action"
      id="custom-preview-action"
      type="button">Accent</button
    >
  </div>
  <p class="control__hint" id="custom-draft-note">
    {valid
      ? "Local sample."
      : "Preview shows the last valid colors. Correct the highlighted hex field."}
  </p>
  {#if valid}{#each analyzeCustomThemeContrast(valid) as warning (warning.label)}<p
        class="control__hint"
      >
        {warning.label}: {warning.ratio.toFixed(2)}:1
      </p>{/each}{/if}
  <div class="custom-theme-buttons">
    <button
      class="btn"
      id="custom-save"
      type="button"
      disabled={busy || !valid || !draft.name.trim()}
      onclick={onsave}>{editing ? "Save changes" : "Save theme"}</button
    >
    <button
      class="btn btn--ghost"
      id="custom-cancel"
      type="button"
      disabled={busy}
      onclick={oncancel}>Cancel</button
    >
  </div>
</div>
