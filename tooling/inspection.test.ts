import { afterEach, describe, expect, test } from "bun:test";
import {
  copyFile,
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectArchive, inspectDirectory } from "./inspection";
import { createManifest, targets } from "./manifest";
import type { Target } from "./manifest";
import { root } from "./paths";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture(target: Target = "chromium"): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "lightfield-package-test-"));
  temporary.push(path);
  await mkdir(join(path, "assets"));
  await writeFile(
    join(path, "manifest.json"),
    JSON.stringify(createManifest(target)),
  );
  await writeFile(
    join(path, "newtab.html"),
    '<script type="module" src="./assets/page.js"></script>',
  );
  await writeFile(
    join(path, "assets/page.js"),
    'console.log("local fixture");',
  );
  await copyFile(
    join(root, "THIRD_PARTY_NOTICES.md"),
    join(path, "THIRD_PARTY_NOTICES.md"),
  );
  await copyFile(
    join(root, "tooling/licenses/svelte-LICENSE.txt"),
    join(path, "SVELTE_LICENSE.txt"),
  );
  return path;
}

describe("package inspection invariants", () => {
  test.each([...targets])(
    "%s accepts only the expected local package",
    async (target) => {
      expect(await inspectDirectory(await fixture(target), target)).toEqual([
        "SVELTE_LICENSE.txt",
        "THIRD_PARTY_NOTICES.md",
        "assets/page.js",
        "manifest.json",
        "newtab.html",
      ]);
    },
  );

  test("rejects added permissions or contexts", async () => {
    const path = await fixture();
    await writeFile(
      join(path, "manifest.json"),
      JSON.stringify({ ...createManifest("chromium"), permissions: ["tabs"] }),
    );
    await rejects(
      inspectDirectory(path, "chromium"),
      /Unexpected chromium manifest/,
    );
  });

  test.each(["https://example.com/page.js", "/assets/page.js", "../page.js"])(
    "rejects nonlocal HTML script %s",
    async (ref) => {
      const path = await fixture();
      await writeFile(
        join(path, "newtab.html"),
        `<script src="${ref}"></script>`,
      );
      await rejects(
        inspectDirectory(path, "chromium"),
        /Nonlocal package path/,
      );
    },
  );

  test("rejects missing local asset", async () => {
    const path = await fixture();
    await rm(join(path, "assets/page.js"));
    await rejects(inspectDirectory(path, "chromium"), /Missing HTML asset/);
  });

  test("rejects inline executable script", async () => {
    const path = await fixture();
    await writeFile(join(path, "newtab.html"), "<script>alert(1)</script>");
    await rejects(
      inspectDirectory(path, "chromium"),
      /Inline executable script/,
    );
  });

  test.each(["data-src", "DATA-SRC"])(
    "rejects inline script disguised with %s",
    async (attribute) => {
      const path = await fixture();
      await writeFile(
        join(path, "newtab.html"),
        `<script ${attribute}="./assets/page.js">alert(1)</script>`,
      );
      await rejects(
        inspectDirectory(path, "chromium"),
        /Inline executable script/,
      );
    },
  );

  test.each([
    '<SCRIPT TYPE="module" SRC = "./assets/page.js"></SCRIPT>',
    "<script src=./assets/page.js></script>",
    '<script data-src="https://example.com/ignored.js" src="./assets/page.js"></script>',
    '<script data-note=\'src="https://example.com/ignored.js"\' src="./assets/page.js"></script>',
    '<script src=".&#47;assets&#47;page.js"></script>',
  ])("parses actual local script attributes: %s", async (html) => {
    const path = await fixture();
    await writeFile(join(path, "newtab.html"), html);
    expect(await inspectDirectory(path, "chromium")).toContain(
      "assets/page.js",
    );
  });

  test.each([
    '<!-- <script src="./assets/page.js"></script> -->',
    '<template><script src="./assets/page.js"></script></template>',
    '<link href="./assets/page.js">',
    '<script type="application/json" src="./assets/page.js"></script>',
  ])("requires an actual executable page script: %s", async (html) => {
    const path = await fixture();
    await writeFile(join(path, "newtab.html"), html);
    await rejects(
      inspectDirectory(path, "chromium"),
      /Missing local page script/,
    );
  });

  test("checks uppercase asset references outside scripts", async () => {
    const path = await fixture();
    await writeFile(
      join(path, "newtab.html"),
      '<script SRC="./assets/page.js"></script><link HREF="./assets/missing.css">',
    );
    await rejects(inspectDirectory(path, "chromium"), /Missing HTML asset/);
  });

  test.each(["assets/page.js.map", "assets/page.ts", "src/secret.js"])(
    "rejects development file %s",
    async (file) => {
      const path = await fixture();
      await mkdir(join(path, "src"), { recursive: true });
      await writeFile(join(path, file), "fixture");
      await rejects(inspectDirectory(path, "chromium"), /Development file/);
    },
  );

  test("rejects symlinks, even if their target is packaged", async () => {
    const path = await fixture();
    await symlink("page.js", join(path, "assets/link.js"));
    await rejects(inspectDirectory(path, "chromium"), /Package symlink/);
  });

  test("rejects development server references in emitted code", async () => {
    const path = await fixture();
    await writeFile(
      join(path, "assets/page.js"),
      'import "http://localhost:5173/@vite/client";',
    );
    await rejects(inspectDirectory(path, "chromium"), /Development reference/);
  });

  test.each(["THIRD_PARTY_NOTICES.md", "SVELTE_LICENSE.txt"])(
    "requires exact preserved notice %s",
    async (file) => {
      const path = await fixture();
      await writeFile(join(path, file), "Removed notices");
      await rejects(inspectDirectory(path, "chromium"), /Missing preserved/);
    },
  );

  test("ZIP must contain the exact inspected bytes, with manifest at root", async () => {
    const path = await fixture();
    const archive = join(tmpdir(), `lightfield-zip-test-${crypto.randomUUID()}.zip`);
    temporary.push(archive);
    const zip = Bun.spawn(["zip", "-q", "-r", archive, "."], {
      cwd: path,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await zip.exited).toBe(0);
    await inspectArchive(archive, path, "chromium");
    await writeFile(join(path, "assets/page.js"), 'console.log("changed");');
    await rejects(
      inspectArchive(archive, path, "chromium"),
      /ZIP content differs/,
    );
  });
});
