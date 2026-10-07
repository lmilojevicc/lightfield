import js from "@eslint/js";
import ts from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import prettier from "eslint-config-prettier";
import svelteConfig from "./svelte.config.js";

export default ts.config(
  {
    ignores: [
      "dist/**",
      "artifacts/**",
      "node_modules/**",
      ".svelte-check/**",
      "src/vendor/neat/**/*.ts",
      "src/vendor/orbs/engine.js",
      "src/vendor/orbs/engine.d.ts",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: { sourceType: "module" },
  },
  ...ts.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.ts", "**/*.svelte"],
  })),
  ...svelte.configs["flat/recommended"],
  {
    files: ["**/*.ts", "**/*.svelte"],
    languageOptions: {
      parserOptions: {
        project: [
          "./tsconfig.app.json",
          "./tsconfig.tooling.json",
          "./tsconfig.tests.json",
          "./tsconfig.native-tests.json",
          "./tsconfig.worker.json",
          "./tsconfig.effects-tests.json",
          "./tsconfig.ui-tests.json",
        ],
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: [".svelte"],
      },
    },
  },
  {
    files: ["**/*.svelte"],
    languageOptions: {
      parserOptions: { parser: ts.parser, svelteConfig },
    },
  },
  prettier,
);
