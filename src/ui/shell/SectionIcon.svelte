<script lang="ts">
  import type { SettingsCategory } from "./settings-presentation";
  const { category }: { category: SettingsCategory } = $props();
</script>

<!-- Lucide 1.42.0 icon nodes; ISC/Feather MIT notices retained in THIRD_PARTY_NOTICES.md. -->
<svg
  class="settings-section-icon"
  viewBox="0 0 24 24"
  width="16"
  height="16"
  fill="none"
  stroke="currentColor"
  stroke-width="1.75"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
>
  {#if category === "appearance"}
    <path
      d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"
    />
    <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /><circle
      cx="17.5"
      cy="10.5"
      r=".5"
      fill="currentColor"
    /><circle cx="6.5" cy="12.5" r=".5" fill="currentColor" /><circle
      cx="8.5"
      cy="7.5"
      r=".5"
      fill="currentColor"
    />
  {:else if category === "background"}
    <path
      d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"
    /><path d="M20 2v4" /><path d="M22 4h-4" /><circle cx="4" cy="20" r="2" />
  {:else if category === "time-date"}
    <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
  {:else if category === "search"}
    <path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" />
  {:else}
    <polyline points="4 7 4 4 20 4 20 7" /><line
      x1="9"
      y1="20"
      x2="15"
      y2="20"
    /><line x1="12" y1="4" x2="12" y2="20" />
  {/if}
</svg>
