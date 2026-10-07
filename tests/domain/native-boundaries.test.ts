import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
async function files(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    const filename = join(path, entry.name);
    if (entry.isDirectory()) result.push(...(await files(filename)));
    else if (filename.endsWith(".ts")) result.push(filename);
  }
  return result;
}
test("native owns no renderer/framework and domain has no browser platform globals", async () => {
  const domain = resolve("src/domain");
  const browserGlobals = new Set([
    "document",
    "window",
    "navigator",
    "indexedDB",
    "Worker",
    "FontFace",
    "localStorage",
    "chrome",
    "browser",
    "crypto",
  ]);
  for (const filename of [
    ...(await files(domain)),
    ...(await files(resolve("src/platform"))),
    ...(await files(resolve("src/services"))),
  ]) {
    const source = ts.createSourceFile(
      filename,
      await readFile(filename, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const imported: string[] = [];
    const globals: string[] = [];
    function visit(node: ts.Node): void {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        imported.push(node.moduleSpecifier.text);
      if (
        filename.startsWith(domain) &&
        ts.isIdentifier(node) &&
        browserGlobals.has(node.text)
      )
        globals.push(node.text);
      ts.forEachChild(node, visit);
    }
    visit(source);
    expect({ file: relative(process.cwd(), filename), globals }).toEqual({
      file: relative(process.cwd(), filename),
      globals: [],
    });
    for (const specifier of imported) {
      expect(specifier).not.toMatch(/svelte|\/effects\/|\/vendor\/|newtab/);
      if (filename.startsWith(domain))
        expect(specifier).not.toMatch(/\/platform\/|\/services\//);
    }
  }
});
