<script lang="ts">
  import { onMount, untrack } from "svelte";
  import type {
    AppServices,
    SettingsSnapshot,
    ImageSessionIntent,
    ImageSnapshot,
  } from "../../services/contracts";
  import type { BackgroundStatus } from "../../effects/runtime/contracts";
  import {
    PAPER_IMAGE_FILTER_IDS,
    PAPER_IMAGE_FILTERS,
    isPaperImageFilter,
  } from "../../shared/background-metadata";
  import { IMAGE_LOCK_REASON } from "../../shared/local-image";
  import { connectThumbnail } from "./thumbnail-view";
  import { attachToTuner, attachFitToTuner } from "./control-state";
  import { ImageViewOwner, type BorrowThumbnail } from "./image-view-owner";
  const {
    services,
    snapshot,
    backgroundStatus,
    visible = false,
    tunerTarget = null,
    tunerFeedback = null,
    borrowThumbnail,
    onretry,
  }: {
    services: AppServices;
    snapshot: SettingsSnapshot;
    backgroundStatus: BackgroundStatus;
    visible?: boolean;
    tunerTarget?: HTMLElement | null;
    tunerFeedback?: HTMLElement | null;
    borrowThumbnail: BorrowThumbnail;
    onretry: () => void | Promise<void>;
  } = $props();
  let fileInput: HTMLInputElement;
  let thumbnailImage: HTMLImageElement;
  let expected: ImageSessionIntent | null = null;
  let imageState = $state<ImageSnapshot>(
    untrack(() => services.images.current()),
  );
  let error = $state("");

  const owner = untrack(() => new ImageViewOwner(services));
  const thumbnail = untrack(() => services.images.createThumbnail());
  const image = $derived(snapshot.settings.localImage);
  const busy = $derived(imageState.state === "saving");
  const blocked = $derived(
    busy || snapshot.unsupportedImage || !snapshot.imageMutationsAvailable,
  );
  const message = $derived(
    error ||
      imageState.error ||
      (snapshot.unsupportedImage
        ? "This saved image schema is unsupported. Background editing is unavailable."
        : "") ||
      (!snapshot.imageMutationsAvailable ? IMAGE_LOCK_REASON : "") ||
      (busy ? "Saving image…" : "") ||
      (snapshot.settings.background === "local-image"
        ? backgroundStatus.message || backgroundStatus.filterMessage
        : ""),
  );
  onMount(() => {
    const stop = services.images.subscribe((s) => (imageState = s));
    const stopThumb = connectThumbnail(thumbnail, thumbnailImage);
    return () => {
      owner.cancel();
      thumbnail.dispose();
      stopThumb();
      stop();
    };
  });
  $effect(() => {
    thumbnail.sync(
      image.assetId,
      snapshot.settings.background === "local-image",
      visible,
      image.assetId && snapshot.settings.background === "local-image"
        ? borrowThumbnail(image.assetId)
        : undefined,
    );
  });
  function dialog() {
    expected = services.images.intent();
    fileInput.value = "";
    fileInput.click();
  }
  async function picked() {
    const file = fileInput.files?.[0],
      intent = expected;
    expected = null;
    if (!file || !intent) return;
    error = "";
    try {
      await owner.import(file, intent);
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    }
  }
  async function change(operation: "use" | "remove" | "cover" | "contain") {
    const intent = services.images.intent();
    error = "";
    try {
      await owner.change(operation, intent);
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    }
  }
  async function filter(value: string) {
    if (value !== "none" && !isPaperImageFilter(value)) return;
    const intent = services.images.intent();
    try {
      await services.settings.patch({
        backgroundRevision: intent.revision,
        localImage: { ...snapshot.settings.localImage, filter: value },
      });
      error = "";
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    }
  }
</script>

<div
  id="personal-grid"
  class="local-image-actions"
  role="group"
  aria-label="Your image"
  aria-busy={busy}
>
  <div
    id="local-image-summary"
    class="local-image-summary"
    data-bg-card="local-image"
    tabindex="-1"
    hidden={!image.assetId}
  >
    <img class="local-image-thumb" alt="" bind:this={thumbnailImage} />
    <div class="local-image-label">
      <strong id="local-image-name"
        >{snapshot.settings.background === "local-image"
          ? "Current image"
          : "Saved image · not in use"}</strong
      ><span class="control__hint">Original thumbnail</span>
    </div>
  </div>
  <input
    id="local-image-file"
    type="file"
    accept="image/jpeg,image/png,image/webp"
    hidden
    bind:this={fileInput}
    onchange={() => {
      void picked();
    }}
  />
  <div class="local-image-buttons">
    <button
      class="btn"
      id="local-image-use"
      type="button"
      hidden={!image.assetId || snapshot.settings.background === "local-image"}
      disabled={blocked}
      onclick={() => {
        void change("use");
      }}>Use original image</button
    >
    <button
      class="btn"
      class:btn--ghost={!!image.assetId}
      id="local-image-add"
      type="button"
      disabled={blocked}
      title="Still JPEG, PNG or WebP, up to 32 MiB / 24 MP / 16,384 px per side. Replacing resets the filter to Original."
      onclick={dialog}
      >{busy
        ? image.assetId
          ? "Replacing…"
          : "Adding…"
        : image.assetId
          ? "Replace…"
          : "Add image…"}</button
    >
    <button
      class="btn btn--ghost"
      id="local-image-remove"
      type="button"
      hidden={!image.assetId}
      disabled={blocked}
      onclick={() => {
        void change("remove");
      }}>Remove</button
    >
  </div>
  <p
    class="control__hint"
    id="local-image-helper"
    hidden={!!image.assetId}
    title="Still images up to 32 MiB, 24 megapixels and 16,384 pixels per side. The original file, including metadata, stays in this browser profile until removed or browser data is cleared. Replacing resets the filter to Original."
  >
    JPEG, PNG or WebP · Never uploaded. Up to 32 MiB / 24 MP.
  </p>
  <label
    use:attachFitToTuner={snapshot.settings.background === "local-image"
      ? tunerTarget
      : null}
    id="local-image-fit-field"
    class="local-image-field"
    hidden={!image.assetId ||
      snapshot.settings.background !== "local-image" ||
      !backgroundStatus.ready}
    ><span>Fit</span><select
      class="select"
      id="local-image-fit"
      value={image.fit}
      disabled={blocked}
      onchange={(e) => {
        void change(e.currentTarget.value === "contain" ? "contain" : "cover");
      }}
      ><option value="cover">Fill screen</option><option value="contain"
        >Show whole image</option
      ></select
    ></label
  >
  <div
    data-background-grid="paper-images"
    id="paper-images-grid"
    hidden={!image.assetId ||
      snapshot.settings.background !== "local-image" ||
      !backgroundStatus.ready}
  >
    <div class="local-image-field">
      <div class="local-image-filter-label">
        <label for="local-image-filter">Filter</label><a
          use:attachToTuner={snapshot.settings.background === "local-image"
            ? tunerFeedback
            : null}
          class="local-image-repo"
          href="https://github.com/paper-design/shaders"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Paper Shaders source repository">Source ↗</a
        >
      </div>
      <select
        class="select"
        id="local-image-filter"
        name="local-image-filter"
        value={image.filter}
        disabled={blocked || snapshot.settings.background !== "local-image"}
        onchange={(e) => {
          void filter(e.currentTarget.value);
        }}
        ><option value="none">Original</option
        >{#each PAPER_IMAGE_FILTER_IDS as id (id)}<option value={id}
            >{PAPER_IMAGE_FILTERS[id].name}</option
          >{/each}</select
      >
    </div>
    <div id="paper-image-controls"></div>
  </div>
  <div
    class="local-image-feedback"
    use:attachToTuner={snapshot.settings.background === "local-image"
      ? tunerFeedback
      : null}
  >
    <p
      class="control__hint"
      id="local-image-status"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      title={backgroundStatus.diagnostic
        ? JSON.stringify(backgroundStatus.diagnostic)
        : undefined}
    >
      {message}
    </p>
    <button
      class="btn btn--ghost"
      id="local-image-retry"
      type="button"
      hidden={!message}
      disabled={busy}
      onclick={() => {
        error = "";
        void onretry();
      }}>Retry</button
    >
  </div>
</div>
