import type { KnipConfig } from "knip";

export default {
  entry: ["tooling/{build,inspect,package}.ts"],
  // Knip 6 does not recognize these CLI names behind `bun --bun`.
  // Both are exercised by validate; keep this exact, not a tool-wide exclusion.
  ignoreDependencies: ["svelte-check", "web-ext"],
  project: [
    "src/**/*.{ts,svelte}",
    "tooling/**/*.ts",
    "tests/{shared,domain,platform,services,effects}/**/*.ts",
  ],
  // Bun discovers tooling and all four real shared/native test directories from package.json.
  // Plugins discover Vite/Svelte/ESLint/Prettier configs and Bun test roots.
  // Never make all effects entries: literal lazy imports must prove reachability.
} satisfies KnipConfig;
