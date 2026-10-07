import type { KnipConfig } from "knip";

export default {
  entry: ["tooling/{build,inspect,package}.ts"],
  // Knip 6 does not recognize these CLI names behind `bun --bun`.
  // Both are exercised by validate; keep this exact, not a tool-wide exclusion.
  ignoreDependencies: ["svelte-check", "web-ext"],
  // TypeScript resolves engine.js to this implicit declaration companion
  // (confirmed by `tsc -p tsconfig.app.json --listFilesOnly`); Knip misses it.
  ignoreIssues: {
    "src/vendor/orbs/engine.d.ts": ["files"],
    // Pinned upstream library APIs, not owned app exports. Preserve source bytes;
    // unused-file checks still apply to every vendor file.
    "src/vendor/neat/license.ts": ["exports", "types"],
    "src/vendor/neat/NeatGradient.ts": ["types"],
    "src/vendor/neat/current/license.ts": ["exports", "types"],
    "src/vendor/neat/current/NeatGradient.ts": ["types"],
    "src/vendor/neat/current/pattern.ts": ["types"],
    "src/vendor/neat/current/patternData.ts": ["exports", "types"],
  },
  project: [
    "src/**/*.{ts,svelte}",
    "tooling/**/*.ts",
    "tests/{shared,domain,platform,services,effects,ui}/**/*.ts",
  ],
  // Bun discovers tooling and all real shared/native/effects/UI test directories from package.json.
  // Plugins discover Vite/Svelte/ESLint/Prettier configs and Bun test roots.
  // Never make all effects entries: literal lazy imports must prove reachability.
} satisfies KnipConfig;
