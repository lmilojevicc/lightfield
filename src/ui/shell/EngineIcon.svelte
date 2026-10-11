<script lang="ts">
  import type { SearchEngine } from "../../domain/settings/schema";
  import {
    SEARCH_ENGINES,
    engineIconPath,
    engineIconSource,
  } from "./search-engines";
  const { engine, size = 18 }: { engine: SearchEngine; size?: number } =
    $props();
</script>

{#if SEARCH_ENGINES.some(({ id }) => id === engine)}
  <img
    src={engineIconPath(engine)}
    width={size}
    height={size}
    aria-hidden="true"
    alt=""
    draggable="false"
    data-source={engineIconSource(engine)}
    class:light-backing={engine === "qwant"}
  />
{/if}

<style>
  img {
    object-fit: contain;
    max-width: 100%;
    max-height: 100%;
  }

  /* Qwant's navy mark needs a theme-neutral light backing. */
  .light-backing {
    background: #fff;
    border-radius: 3px;
  }
</style>
