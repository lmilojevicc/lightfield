<script lang="ts">
  import { onMount, untrack } from "svelte";
  import type {
    AppServices,
    SettingsSnapshot,
    SettingsDraft,
  } from "../../services/contracts";
  import type { BackgroundStatus } from "../../effects/runtime/contracts";
  import {
    BACKGROUND_COLLECTIONS,
    getBackgroundDescriptor,
    type BackgroundId,
    type BackgroundControlValue,
  } from "../../shared/background-metadata";
  import {
    controlValues,
    selectedControls,
    tuningScope,
    relocate,
    attachToTuner,
  } from "./control-state";
  import type { BorrowThumbnail } from "./image-view-owner";
  import { createDisclosureMotion } from "./disclosure-motion";
  import EffectControls from "./EffectControls.svelte";
  import LocalImageControls from "./LocalImageControls.svelte";
  const {
    services,
    snapshot,
    backgroundStatus,
    visible = false,
    tunerTarget = null,
    tunerFeedback = null,
    tunerActions = null,
    onopen,
    onretry,
    borrowThumbnail,
    resolveAsset = (path: string) => path,
  }: {
    services: AppServices;
    snapshot: SettingsSnapshot;
    backgroundStatus: BackgroundStatus;
    visible?: boolean;
    tunerTarget?: HTMLElement | null;
    tunerFeedback?: HTMLElement | null;
    tunerActions?: HTMLElement | null;
    onopen: () => void;
    onretry: () => void | Promise<void>;
    borrowThumbnail: BorrowThumbnail;
    resolveAsset?: (path: string) => string;
  } = $props();
  let query = $state("");
  let animated = $state<string | null>(null);
  const motion = createDisclosureMotion(() => services.reducedMotion());
  function disclosure(
    toggle: HTMLButtonElement,
    state: { open: boolean; animate: boolean },
  ) {
    motion.setExpanded(toggle, state.open, state.animate);
    return {
      update(next: { open: boolean; animate: boolean }) {
        motion.setExpanded(toggle, next.open, next.animate);
      },
      destroy() {
        motion.finishAll();
      },
    };
  }
  onMount(() => {
    const stop = services.subscribeReducedMotion(motion.finishAll);
    window.addEventListener("resize", motion.finishAll);
    return () => {
      motion.finishAll();
      stop();
      window.removeEventListener("resize", motion.finishAll);
    };
  });
  $effect(() => {
    if (!visible || tunerTarget) motion.finishAll();
  });
  let expanded = $state<string[]>(
    untrack(() =>
      BACKGROUND_COLLECTIONS.filter((c) =>
        c.ids.includes(snapshot.settings.background),
      ).map((c) => c.id),
    ),
  );
  let home = $state<HTMLDivElement>();
  let group = $state<HTMLDivElement>();
  let error = $state("");
  let resetToken = $state(0);
  let draft: SettingsDraft | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function flush() {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    const pending = draft;
    draft = null;
    if (pending) save(pending.commit());
  }
  const settings = $derived(snapshot.settings);
  const descriptor = $derived(selectedControls(settings));
  const scope = $derived(tuningScope(settings));
  const values = $derived(controlValues(settings));
  const term = $derived(query.trim().toLowerCase());
  const count = $derived(
    BACKGROUND_COLLECTIONS.filter((c) => c.id !== "personal").flatMap((c) =>
      c.ids.filter((id) => matches(id, c.name)),
    ).length,
  );
  function matches(id: BackgroundId, collection: string) {
    return (
      !term ||
      `${collection === "Neat" ? "neat " : ""}${getBackgroundDescriptor(id).name}`
        .toLowerCase()
        .includes(term)
    );
  }
  function toggle(id: string) {
    animated = id;
    expanded = expanded.includes(id)
      ? expanded.filter((x) => x !== id)
      : [...expanded, id];
  }
  function save(work: Promise<unknown>) {
    void work.catch((reason: unknown) => {
      error = reason instanceof Error ? reason.message : String(reason);
    });
  }
  function select(background: BackgroundId) {
    error = "";
    flush();
    save(services.settings.patch({ background }));
  }
  function update(key: string, value: BackgroundControlValue) {
    error = "";
    const current = services.settings.current().settings;
    if (tuningScope(current) !== scope) return;
    const patch =
      current.background === "local-image" &&
      current.localImage.filter !== "none"
        ? {
            backgroundRevision: current.backgroundRevision,
            localImage: {
              ...current.localImage,
              filterOverrides: {
                [current.localImage.filter]: {
                  ...controlValues(current),
                  [key]: value,
                },
              },
            },
          }
        : {
            backgroundOverrides: {
              ...current.backgroundOverrides,
              [current.background]: { ...controlValues(current), [key]: value },
            },
          };
    clearTimeout(saveTimer);
    draft?.cancel();
    try {
      draft = services.settings.stage(patch);
      saveTimer = setTimeout(flush, 300);
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    }
  }
  function reset() {
    error = "";
    resetToken++;
    flush();
    const current = services.settings.current().settings;
    if (tuningScope(current) !== scope) return;
    const defaults = selectedControls(current).defaults;
    if (
      current.background === "local-image" &&
      current.localImage.filter !== "none"
    )
      save(
        services.settings.patch({
          backgroundRevision: current.backgroundRevision,
          localImage: {
            ...current.localImage,
            filterOverrides: { [current.localImage.filter]: { ...defaults } },
          },
        }),
      );
    else
      save(
        services.settings.patch({
          backgroundOverrides: {
            ...current.backgroundOverrides,
            [current.background]: { ...defaults },
          },
        }),
      );
  }
  $effect(() => {
    if (group && home) relocate(group, tunerTarget ?? home);
  });
  onMount(() => () => {
    flush();
    if (group && home) relocate(group, home);
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role (source tabpanel semantics) -->
<section
  class="group modal__panel"
  data-settings-category="background"
  id="panel-backgrounds"
  role="tabpanel"
  aria-labelledby="tab-btn-backgrounds"
  hidden={!visible}
>
  <div class="panel__header">
    <h3 class="panel__title">Background Engine &amp; Wallpapers</h3>
  </div>
  <div class="control background-picker-control">
    <div
      class="bg-picker"
      id="background-picker"
      role="group"
      aria-label="Choose a background"
    >
      <div class="background-sources" data-background-grid="personal">
        <label class="bg-card bg-none-row" data-bg-card="none"
          ><input
            type="radio"
            name="background"
            value="none"
            data-setting="background"
            checked={settings.background === "none"}
            disabled={snapshot.unsupportedImage}
            onchange={() => {
              select("none");
            }}
          /><span class="bg-card__body"
            ><span class="bg-card__name">Plain · theme color</span></span
          ></label
        >
        <LocalImageControls
          {tunerTarget}
          {tunerFeedback}
          {services}
          {snapshot}
          {backgroundStatus}
          {visible}
          {borrowThumbnail}
          {onretry}
        />
      </div>
      <h4 class="background-effects-heading">Collections &amp; Shaders</h4>
      <label class="visually-hidden" for="background-filter"
        >Search effects</label
      >
      <input
        class="settings-filter"
        id="background-filter"
        type="search"
        placeholder="Search effects…"
        autocomplete="off"
        spellcheck="false"
        maxlength="60"
        aria-controls="background-picker-options"
        aria-describedby="background-filter-status"
        bind:value={query}
        oninput={() => {
          animated = null;
          motion.finishAll();
        }}
      />
      <p
        class="filter-status"
        id="background-filter-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {term
          ? count === 0
            ? "No backgrounds found."
            : `${String(count)} background${count === 1 ? "" : "s"} found.`
          : ""}
      </p>
      <div id="background-picker-options">
        {#each BACKGROUND_COLLECTIONS.filter((c) => c.id !== "personal") as collection (collection.id)}
          {@const open = !!term || expanded.includes(collection.id)}
          <div
            class="bg-collection"
            data-background-grid={collection.id}
            hidden={!collection.ids.some((id) => matches(id, collection.name))}
          >
            <h4 class="bg-collection__head">
              <button
                class="bg-collection__toggle"
                type="button"
                aria-expanded="false"
                use:disclosure={{
                  open,
                  animate: animated === collection.id && !term,
                }}
                disabled={!!term}
                aria-disabled={!!term}
                aria-controls={`${collection.id}-grid`}
                onclick={() => {
                  toggle(collection.id);
                }}
                ><span class="bg-collection__name">{collection.name}</span
                ></button
              >
              {#if collection.link}<a
                  use:attachToTuner={collection.ids.includes(
                    settings.background,
                  )
                    ? tunerFeedback
                    : null}
                  class="bg-collection__link"
                  aria-label={`${collection.name} source repository`}
                  href={collection.id === "neat"
                    ? "https://github.com/FireCMSco/neat"
                    : collection.id === "paper"
                      ? "https://github.com/paper-design/shaders"
                      : collection.id === "pixel-perfect"
                        ? "https://github.com/vansh-nagar/Pixel-Perfect"
                        : collection.link.href}
                  target="_blank"
                  rel="noopener noreferrer">Source ↗</a
                >{/if}
            </h4>
            <div
              class="bg-collection__body"
              id={`${collection.id}-grid`}
              hidden
            >
              <div class="bg-collection__grid">
                {#each collection.ids as id (id)}
                  <label
                    class="bg-card"
                    data-bg-card={id}
                    hidden={!matches(id, collection.name)}
                  >
                    <input
                      type="radio"
                      name="background"
                      value={id}
                      data-setting="background"
                      checked={settings.background === id}
                      disabled={snapshot.unsupportedImage}
                      onchange={() => {
                        select(id);
                      }}
                    />
                    <span class="bg-card__body"
                      ><span class="bg-card__preview" aria-hidden="true"
                        ><img
                          class="bg-card__preview-img"
                          src={resolveAsset(`previews/${id}.webp`)}
                          alt=""
                          loading="lazy"
                          decoding="async"
                        /></span
                      ><span class="bg-card__name"
                        >{getBackgroundDescriptor(id).name}</span
                      ><span class="bg-card__selected">Selected</span></span
                    >
                  </label>
                {/each}
              </div>
            </div>
          </div>
        {/each}
      </div>
      <div
        id="background-feedback"
        class="background-feedback"
        role="status"
        aria-live="polite"
      >
        <p
          class="control__hint"
          id="background-error"
          hidden={!error && !backgroundStatus.message}
        >
          {error || backgroundStatus.message}
        </p>
        <button
          class="btn btn--ghost"
          id="background-retry"
          type="button"
          hidden={!error && !backgroundStatus.message}
          onclick={() => {
            error = "";
            void onretry();
          }}>Retry</button
        >
      </div>
      <button
        class="btn"
        id="effect-tune"
        type="button"
        hidden={!scope}
        onclick={onopen}>{descriptor.name} settings</button
      >
      <div id="background-controls-home" hidden inert bind:this={home}>
        <div
          class="background-controls"
          id="background-controls"
          hidden={!scope}
          data-scope={scope ?? ""}
          bind:this={group}
        >
          <div id="background-fields">
            {#key `${scope ?? ""}/${String(resetToken)}`}<EffectControls
                controls={descriptor.controls}
                {values}
                source={settings.background}
                disabled={snapshot.unsupportedImage ||
                  (settings.background === "local-image" &&
                    !snapshot.imageMutationsAvailable)}
                tuning={!!tunerTarget}
                onchange={update}
                oncommit={flush}
              />{/key}
          </div>
          <button
            use:attachToTuner={tunerActions}
            class="btn btn--ghost background-reset"
            id="background-reset"
            type="button"
            disabled={snapshot.unsupportedImage ||
              (settings.background === "local-image" &&
                !snapshot.imageMutationsAvailable)}
            onclick={reset}
            >{settings.background === "local-image"
              ? "Reset filter"
              : "Reset effect"}</button
          >
        </div>
      </div>
    </div>
  </div>
</section>
