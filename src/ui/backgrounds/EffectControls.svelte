<script lang="ts">
  import { untrack } from "svelte";
  import type { ImageFilterControl } from "../../shared/image-filter-metadata";
  import type { BackgroundControlValue } from "../../shared/background-metadata";
  import ControlField from "./ControlField.svelte";
  const {
    controls,
    values,
    source,
    disabled = false,
    tuning = false,
    onchange,
    oncommit,
  }: {
    controls: readonly ImageFilterControl[];
    values: Record<string, BackgroundControlValue>;
    source: string;
    disabled?: boolean;
    tuning?: boolean;
    oncommit: () => void;
    onchange: (key: string, value: BackgroundControlValue) => void;
  } = $props();
  let advanced = $state(false);
  let beforeTuning = false;
  $effect(() => {
    if (tuning) {
      beforeTuning = untrack(() => advanced);
      advanced = true;
    } else advanced = beforeTuning;
  });
</script>

{#each controls.filter((c) => !c.advanced) as control (control.key)}
  <ControlField {control} {values} {source} {disabled} {onchange} {oncommit} />
{/each}
{#if controls.some((c) => c.advanced)}
  <details class="background-advanced" bind:open={advanced}>
    <summary>Advanced</summary>
    {#each controls.filter((c) => c.advanced) as control (control.key)}
      <ControlField
        {control}
        {values}
        {source}
        {disabled}
        {onchange}
        {oncommit}
      />
    {/each}
  </details>
{/if}
