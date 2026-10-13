import { readdir, readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { join, posix } from "node:path";
import { createHash } from "node:crypto";
import { html as htmlNamespaces, parse } from "parse5";
import type { DefaultTreeAdapterTypes } from "parse5";
import { createManifest } from "./manifest";
import type { Target } from "./manifest";

async function listPackageFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(relative: string): Promise<void> {
    for (const entry of await readdir(join(directory, relative), {
      withFileTypes: true,
    })) {
      const path = posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Package symlink: ${path}`);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
      else throw new Error(`Unsupported package entry: ${path}`);
    }
  }
  await visit("");
  return files.sort();
}

function assertLocalPath(path: string): void {
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").includes("..") ||
    /^[a-z]+:/i.test(path)
  ) {
    throw new Error(`Nonlocal package path: ${path}`);
  }
}

export async function inspectDirectory(
  directory: string,
  target: Target,
): Promise<string[]> {
  const files = await listPackageFiles(directory);
  for (const path of files) {
    assertLocalPath(path);
    if (
      /(?:^|\/)(?:node_modules|src|tooling|\.git)(?:\/|$)/.test(path) ||
      /\.(?:map|ts|svelte)$/.test(path)
    ) {
      throw new Error(`Development file in package: ${path}`);
    }
  }
  const read = (path: string) => readFile(join(directory, path), "utf8");
  const manifest: unknown = JSON.parse(await read("manifest.json"));
  if (!isDeepStrictEqual(manifest, createManifest(target))) {
    throw new Error(`Unexpected ${target} manifest (permissions/CSP/entry)`);
  }
  // Exact snapshot notices preserve unverified permissions and full licenses.
  // Changing these pins needs provenance/legal review, not formatter output.
  const notices = [
    [
      "THIRD_PARTY_NOTICES.md",
      "42cddbd87e9990286b078d99bce3bd4ff36bfb9cd83d953cbb2116f76c89a431",
    ],
    [
      "SVELTE_LICENSE.txt",
      "06257f4847b13a49a039efb17b944c141e71b12fd8d231b362d86919067d77a3",
    ],
  ] as const;
  for (const [path, expected] of notices) {
    const hash = createHash("sha256")
      .update(await read(path))
      .digest("hex");
    if (hash !== expected) throw new Error(`Missing preserved notice: ${path}`);
  }
  const html = await read("newtab.html");
  const refs: string[] = [];
  const pageScripts: string[] = [];
  function visitHtml(node: DefaultTreeAdapterTypes.Node): void {
    if ("tagName" in node) {
      // HTML parsing normalizes case and distinguishes src from data-src,
      // quoted attribute text, comments and inert template contents.
      const src = node.attrs.find((attribute) => attribute.name === "src");
      if (node.tagName === "script") {
        if (!src) throw new Error("Inline executable script in newtab.html");
        const type =
          node.attrs
            .find((attribute) => attribute.name === "type")
            ?.value.trim()
            .toLowerCase() ?? "";
        if (
          node.namespaceURI === htmlNamespaces.NS.HTML &&
          src.value.endsWith(".js") &&
          ["", "module", "text/javascript", "application/javascript"].includes(
            type,
          )
        ) {
          pageScripts.push(src.value);
        }
      }
      for (const attribute of node.attrs) {
        if (attribute.name === "src" || attribute.name === "href") {
          refs.push(attribute.value);
        }
      }
    }
    if ("childNodes" in node) {
      for (const child of node.childNodes) visitHtml(child);
    }
  }
  visitHtml(parse(html));
  if (pageScripts.length === 0) throw new Error("Missing local page script");
  for (const ref of refs) {
    if (!ref) throw new Error("Empty HTML asset reference");
    assertLocalPath(ref);
    if (!files.includes(posix.normalize(ref))) {
      throw new Error(`Missing HTML asset: ${ref}`);
    }
  }
  for (const path of files.filter((file) => /\.(?:html|js|css)$/.test(file))) {
    const content = await read(path);
    if (
      /(?:https?:\/\/localhost|https?:\/\/127\.0\.0\.1|@vite\/client|\/src\/app\/main\.ts|sourceMappingURL)/.test(
        content,
      )
    ) {
      throw new Error(`Development reference in ${path}`);
    }
  }
  return files;
}

export async function inspectArchive(
  archive: string,
  directory: string,
  target: Target,
): Promise<void> {
  const expected = await inspectDirectory(directory, target);
  const listing = Bun.spawn(["unzip", "-Z1", archive], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const entries = (await new Response(listing.stdout).text())
    .trim()
    .split("\n")
    .filter((path) => !path.endsWith("/"));
  if ((await listing.exited) !== 0) throw new Error("Cannot list ZIP");
  for (const path of entries) assertLocalPath(path);
  if (!isDeepStrictEqual(entries.sort(), expected)) {
    throw new Error("ZIP file set differs from inspected directory");
  }
  // Compare every archived byte, not merely the manifest or file count.
  for (const path of expected) {
    const extract = Bun.spawn(["unzip", "-p", archive, path], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const bytes = Buffer.from(await new Response(extract.stdout).arrayBuffer());
    if (
      (await extract.exited) !== 0 ||
      !bytes.equals(await readFile(join(directory, path)))
    ) {
      throw new Error(`ZIP content differs: ${path}`);
    }
  }
}
