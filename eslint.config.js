// ESLint covers .svelte files only; Oxlint (.oxlintrc.json) lints everything else.
// Oxlint cannot lint Svelte markup (svelte/* rules) or run type-aware rules inside
// .svelte scripts, so those stay here.
import js from "@eslint/js";
import ts from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import prettier from "eslint-config-prettier";
import svelteConfig from "./svelte.config.js";

export default ts.config(
  {
    ignores: ["dist/**", "artifacts/**", "node_modules/**", ".svelte-check/**"],
  },
  {
    files: ["**/*.svelte"],
    extends: [js.configs.recommended, ...ts.configs.strictTypeChecked],
  },
  ...svelte.configs["flat/recommended"],
  {
    files: ["**/*.svelte"],
    languageOptions: {
      parserOptions: {
        parser: ts.parser,
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: [".svelte"],
        svelteConfig,
      },
    },
  },
  prettier,
);
