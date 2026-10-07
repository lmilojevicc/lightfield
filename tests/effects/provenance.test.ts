import { requiredValue } from "../../src/effects/runtime/required-value";
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import ts from "typescript";
import { verifyEffectProvenance } from "../../tooling/effects-provenance";
import shaderText from "../../tooling/effects-shader-text.json";
import {
  BACKGROUND_IDS,
  BACKGROUND_IMPLEMENTATION_IDS,
} from "../../src/shared/background-metadata";
import { PAPER_IMAGE_FILTER_IDS } from "../../src/shared/image-filter-metadata";
import {
  BACKGROUND_LOADER_IDS,
  backgroundLoaders,
  localImageLoader,
} from "../../src/effects/runtime/loaders";
import { imageFilterLoaders } from "../../src/effects/paper/images/adapter";

const root = new URL("../../", import.meta.url).pathname;
test("source bytes: all quarantined engines, licenses, fixtures and 113 public assets stay pinned", async () => {
  expect(await verifyEffectProvenance(root)).toBe(137);
  const previews = await readdir(
    new URL("../../public/previews", import.meta.url),
  );
  expect(previews.filter((path) => path.endsWith(".webp"))).toHaveLength(95);
  const fonts = await readdir(new URL("../../public/fonts", import.meta.url));
  expect(fonts.filter((path) => path.endsWith(".woff2"))).toHaveLength(7);
  for (const id of [
    ...BACKGROUND_IDS.filter((id) => id !== "none"),
    "personal-collection",
    ...PAPER_IMAGE_FILTER_IDS,
    "paper-image-original",
  ])
    expect(previews).toContain(`${id}.webp`);
});

test("84 literal procedural factories, distinct Local Image loader and seven filter modules are reachable", async () => {
  expect([...BACKGROUND_LOADER_IDS].sort()).toEqual(
    [...BACKGROUND_IMPLEMENTATION_IDS].sort(),
  );
  expect(new Set(BACKGROUND_LOADER_IDS).size).toBe(84);
  for (const id of BACKGROUND_IMPLEMENTATION_IDS) {
    const module = await backgroundLoaders[id]();
    expect(typeof module.default).toBe("function");
  }
  expect(typeof (await localImageLoader()).createLocalImage).toBe("function");
  expect(Object.keys(imageFilterLoaders).sort()).toEqual(
    [...PAPER_IMAGE_FILTER_IDS].sort(),
  );
  for (const id of PAPER_IMAGE_FILTER_IDS)
    expect((await imageFilterLoaders[id]()).fragment.length).toBeGreaterThan(
      100,
    );
});

test("authored GLSL retains exact source text without freezing adapter architecture", async () => {
  for (const entry of shaderText) {
    const text = await readFile(
      new URL(`../../${entry.path}`, import.meta.url),
      "utf8",
    );
    const source = ts.createSourceFile(
      entry.path,
      text,
      ts.ScriptTarget.Latest,
      true,
    );
    const pieces: string[] = [];
    function visit(node: ts.Node): void {
      if (
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)
      ) {
        let owner: ts.Node = node;
        while (!ts.isSourceFile(owner) && !ts.isVariableDeclaration(owner))
          owner = owner.parent;
        if (
          ts.isVariableDeclaration(owner) &&
          /(?:shader|glsl|vertex|fragment|noise|injection|header)/i.test(
            owner.name.getText(source),
          )
        )
          pieces.push(node.rawText ?? node.text);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    expect(pieces).toHaveLength(entry.segments);
    expect(
      createHash("sha256").update(JSON.stringify(pieces)).digest("hex"),
    ).toBe(entry.sha256);
  }
});

test("native compiler scope preserves owned verbatim imports but erases pinned Neat interface-only imports", async () => {
  function config(path: string): ts.ParsedCommandLine {
    return requiredValue(
      ts.getParsedCommandLineOfConfigFile(
        path,
        {},
        {
          ...ts.sys,
          onUnRecoverableConfigFileDiagnostic(diagnostic) {
            throw new Error(
              ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
            );
          },
        },
      ),
    );
  }
  const vendorConfig = config(
    new URL("../../src/vendor/neat/tsconfig.json", import.meta.url).pathname,
  );
  const ownedConfig = config(
    new URL("../../tsconfig.app.json", import.meta.url).pathname,
  );
  expect(vendorConfig.options.verbatimModuleSyntax).toBe(false);
  expect(ownedConfig.options.verbatimModuleSyntax).toBe(true);
  const control =
    'import { BackgroundStatus } from "./contracts"; export const status: BackgroundStatus | null = null;';
  expect(
    ts.transpileModule(control, { compilerOptions: ownedConfig.options })
      .outputText,
  ).toContain("import { BackgroundStatus }");
  expect(
    ts.transpileModule(control, { compilerOptions: vendorConfig.options })
      .outputText,
  ).not.toContain("import { BackgroundStatus }");
  for (const path of ["NeatGradient.ts", "current/NeatGradient.ts"]) {
    const source = await readFile(
      new URL(`../../src/vendor/neat/${path}`, import.meta.url),
      "utf8",
    );
    const output = ts.transpileModule(source, {
      compilerOptions: vendorConfig.options,
    }).outputText;
    expect(output).not.toMatch(
      /import\s*\{[^}]*\b(?:NeatConfig|NeatColor|NeatController|PatternShape|Pattern)\b[^}]*\}\s*from/,
    );
    expect(output).toContain("Neat Gradients v");
  }
});
