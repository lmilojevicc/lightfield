<script lang="ts">
  const { code }: { code: number | null } = $props();
</script>

{#if code !== null}
  {#if code === 0}
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      ><circle cx="12" cy="12" r="4"></circle><path
        d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32 1.41-1.41"
      ></path></svg
    >
  {:else if code === 1 || code === 2}
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      ><path
        d="M12 2v2M4.93 4.93l1.41 1.41M2 12h2M20 12h2M19.07 4.93l-1.41 1.41"
      ></path><path
        d="M15.5 17.5a4.5 4.5 0 0 0-3.5-7.3 4.5 4.5 0 0 0-4.3 3.3A3.5 3.5 0 0 0 8.5 20.5h7a3.5 3.5 0 0 0 0-3z"
      ></path></svg
    >
  {:else if (code >= 51 && code <= 67) || (code >= 80 && code <= 82)}
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      ><path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"></path><path
        d="m8 19-2 3m6-3-2 3m6-3-2 3"
      ></path></svg
    >
  {:else}
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      ><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"
      ></path></svg
    >
  {/if}
{/if}
