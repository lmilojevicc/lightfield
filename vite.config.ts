import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [svelte()],
  // No dev server in extension artifacts; production chunks stay same-origin.
  worker: { format: "es" },
  build: {
    target: ["chrome131", "firefox134"],
    sourcemap: false,
    rolldownOptions: { input: "newtab.html" },
  },
});
