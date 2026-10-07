import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import ts from "typescript";

test("shared contract import graph is acyclic and has no engine, framework, domain or DOM dependency", () => {
  const root = resolve(import.meta.dir, "../../src/shared");
  const graph = new Map<string, string[]>();
  const forbiddenGlobals = new Set([
    "document",
    "window",
    "HTMLElement",
    "HTMLImageElement",
    "Blob",
    "Bun",
    "fetch",
    "localStorage",
    "indexedDB",
  ]);
  for (const filename of readdirSync(root).filter((name) =>
    name.endsWith(".ts"),
  )) {
    const path = resolve(root, filename);
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const imports: string[] = [];
    function visit(node: ts.Node): void {
      if (ts.isIdentifier(node))
        expect(
          forbiddenGlobals.has(node.text),
          `${filename}: forbidden runtime/type ${node.text}`,
        ).toBe(false);
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        const specifier = node.moduleSpecifier;
        if (specifier && ts.isStringLiteral(specifier)) {
          expect(
            specifier.text.startsWith("./"),
            `${filename}: shared-only import`,
          ).toBe(true);
          const dependency = resolve(dirname(path), `${specifier.text}.ts`);
          expect(dirname(dependency)).toBe(root);
          imports.push(dependency);
        }
      }
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      )
        throw new Error(
          `${filename}: lazy loaders belong to effects, not metadata`,
        );
      ts.forEachChild(node, visit);
    }
    visit(source);
    graph.set(path, imports);
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  function walk(path: string): void {
    expect(active.has(path), `import cycle through ${path}`).toBe(false);
    if (visited.has(path)) return;
    active.add(path);
    const imports = graph.get(path);
    if (!imports) throw new Error(`Missing shared dependency: ${path}`);
    for (const dependency of imports) walk(dependency);
    active.delete(path);
    visited.add(path);
  }
  for (const path of graph.keys()) walk(path);
  expect(visited.size).toBe(graph.size);
});
