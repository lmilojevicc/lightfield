<script lang="ts">
  import type { SearchEngine } from "../../domain/settings/schema";
  const { engine, size = 18 }: { engine: SearchEngine; size?: number } =
    $props();
</script>

{#if engine === "google"}
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"
    ><rect width="24" height="24" rx="5" fill="#ffffff" /><path
      fill="#4285F4"
      d="M19.7 12.2c0-.6-.05-1.1-.15-1.7H12v3.2h4.3c-.2 1-.8 1.9-1.7 2.5v2h2.7c1.6-1.5 2.5-3.6 2.5-6z"
    /><path
      fill="#34A853"
      d="M12 20c2.2 0 4-.7 5.3-2l-2.6-2c-.7.5-1.6.8-2.7.8-2.1 0-3.9-1.4-4.5-3.3H4.7v2.1C6.1 18.3 8.8 20 12 20z"
    /><path
      fill="#FBBC05"
      d="M7.5 13.5c-.2-.5-.3-1-.3-1.5s.1-1 .3-1.5V8.4H4.7C4.2 9.5 4 10.7 4 12s.2 2.5.7 3.6l2.8-2.1z"
    /><path
      fill="#EA4335"
      d="M12 7.2c1.2 0 2.2.4 3 1.2l2.3-2.3C15.9 4.8 14.1 4 12 4 8.8 4 6.1 5.7 4.7 8.4l2.8 2.1c.6-1.9 2.4-3.3 4.5-3.3z"
    /></svg
  >
{:else if engine === "duckduckgo"}
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"
    ><rect width="24" height="24" rx="5" fill="#DE5833" /><path
      fill="#FFFFFF"
      d="M12 4.5c-2.4 0-4.2 1.5-4.2 3.6 0 1.2.6 2.3 1.6 2.9-.2.5-.6 1.2-1 1.7 1.1.1 2.1-.3 2.8-.9.3.05.5.07.8.07 2.4 0 4.2-1.5 4.2-3.6s-1.8-3.7-4.2-3.7z"
    /><circle cx="13.8" cy="7.6" r="0.9" fill="#1E2327" /><path
      fill="#F3A228"
      d="M13.8 8.4c1.1.2 2.6.6 2.8 1.2-.3.7-1.8.8-2.9.6-.3-.1-.4-.6.1-1.8z"
    /><polygon
      points="10.8,14.6 12,13.5 13.2,14.6 12,15.7"
      fill="#429A46"
    /><circle cx="12" cy="14.6" r="0.6" fill="#FFFFFF" /></svg
  >
{:else if engine === "bing"}
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"
    ><rect width="24" height="24" rx="5" fill="#008080" /><path
      fill="#FFFFFF"
      d="M7 4.5v15l5.5-3.2 3.8 2.2 2.8-1.6-4.5-7.8 4.4-2.5L12.5 4.5H7zm2.4 2.5h2.2l4.2 3.7-3.2 1.8 3.5 6.1-1.8 1-3-1.7-1.9 1.1V7z"
    /></svg
  >
{:else if engine === "brave"}
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"
    ><rect width="24" height="24" rx="5" fill="#FB542B" /><path
      fill="#FFFFFF"
      d="M12 4.2l-6 3v4.5c0 4.2 2.8 7.8 6 8.8 3.2-1 6-4.6 6-8.8V7.2l-6-3zm0 2.2l4.2 2.1v2.5c0 2.8-1.8 5.4-4.2 6.2-2.4-.8-4.2-3.4-4.2-6.2V8.5l4.2-2.1z"
    /><circle cx="10.2" cy="10.8" r="1" fill="#FFFFFF" /><circle
      cx="13.8"
      cy="10.8"
      r="1"
      fill="#FFFFFF"
    /><polygon points="12,12 10.8,13.8 13.2,13.8" fill="#FFFFFF" /></svg
  >
{:else if engine === "ecosia"}
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"
    ><rect width="24" height="24" rx="5" fill="#00805A" /><path
      fill="#FFFFFF"
      d="M12 4.5c-3 0-5.5 2.2-5.5 5 0 2 1.2 3.7 2.9 4.5v3h2.6v-2.8c.3.1.6.1.9.1 3 0 5.5-2.2 5.5-5 0-2.8-2.5-4.8-6.4-4.8zm-.9 2.8c.4-.2.8-.2 1.1 0 .4.3.7.7.7 1.2 0 1.1-.8 2-1.8 2-.5 0-1-.3-1.3-.6-.3-.4-.3-1 0-1.4.3-.5.7-.9 1.3-1.2zm3.1 3.8c-.4.3-.8.4-1.3.3-.4-.1-.7-.3-.9-.6-.3-.4-.2-1.1.3-1.4.4-.3.8-.4 1.3-.3.4.1.8.4 1 .8.2.4.1 1-.4 1.2z"
    /></svg
  >
{:else if engine === "kagi"}
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"
    ><rect width="24" height="24" rx="5" fill="#FFC83B" /><path
      fill="#24292F"
      d="M7.8 7l1.5 2.6c.4-.1.8-.2 1.3-.2 1.7 0 3.1 1 3.7 2.5l3.4.4c.5.1.8.5.8.9 0 .6-.5.9-1 .9l-3.1.1c-.2.8-.7 1.4-1.3 1.9l1.4 2.3c.2.4.1.8-.3 1-.4.2-.8.1-1-.3l-1.4-2.3c-.5.2-1 .3-1.7.3-2.3 0-4.2-1.9-4.2-4.2 0-1.4.7-2.6 1.7-3.4L7.5 7.6c-.2-.4-.1-.8.3-1 .4-.2.8-.1 1 .3l.8 1.4c-.6.6-1.2 1.3-1.5 2.1l-.8-1.4c-.2-.3-.5-.4-.7-.4-.2 0-.5.1-.6.2-.4.3-.5.6-.3 1z"
    /><circle cx="11.5" cy="11.2" r="0.9" fill="#FFC83B" /></svg
  >
{:else if engine === "startpage"}
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"
    ><rect width="24" height="24" rx="5" fill="#0152F3" /><path
      fill="#FFFFFF"
      d="M10.8 6a4.8 4.8 0 1 0 3.3 8.2l4.1 4.1 1.4-1.4-4.1-4.1A4.8 4.8 0 0 0 10.8 6zm0 2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6z"
    /></svg
  >
{:else if engine === "qwant"}
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"
    ><rect width="24" height="24" rx="5" fill="#1E2337" /><circle
      cx="11.5"
      cy="11"
      r="6"
      fill="none"
      stroke="#2575FC"
      stroke-width="2.6"
    /><circle cx="11.5" cy="11" r="3.2" fill="#00D26A" /><path
      fill="#FF4D4D"
      d="M13.8 13.8l4 4a1.3 1.3 0 0 1-1.8 1.8l-4-4 1.8-1.8z"
    /></svg
  >
{/if}
