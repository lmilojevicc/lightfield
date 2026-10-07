import { expect, test } from "bun:test";
import { mkdtemp, writeFile, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "vite";
import viteConfig from "../../vite.config";
test("actual image preparer emits a separate packaged static module worker, not a document-relative JS guess", async () => {
  const root = await mkdtemp(join(tmpdir(), "lightfield-native-worker-"));
  try {
    await writeFile(
      join(root, "newtab.html"),
      '<script type="module" src="./main.ts"></script>',
    );
    await writeFile(
      join(root, "main.ts"),
      `import { prepareLocalImage } from ${JSON.stringify(resolve("src/platform/images/local-image-loading.ts"))}; document.addEventListener('click',()=>{ void prepareLocalImage(new Blob(['test']),'cover'); });`,
    );
    await build({
      ...viteConfig,
      configFile: false,
      root,
      publicDir: false,
      logLevel: "silent",
      build: { ...viteConfig.build, outDir: "dist", minify: false },
    });
    const directory = join(root, "dist/assets"),
      files = await readdir(directory);
    const worker = files.find(
      (file) =>
        file.startsWith("local-image-decode.worker-") && file.endsWith(".js"),
    );
    const main = files.find(
      (file) => file.startsWith("newtab-") && file.endsWith(".js"),
    );
    if (!worker || !main) throw new Error("Actual native worker missing");
    const page = await readFile(join(directory, main), "utf8");
    const code = await readFile(join(directory, worker), "utf8");
    expect(page).toContain(worker);
    expect(page).toContain('type: "module"');
    expect(page).not.toContain("local-image-decode.worker.js");
    expect(code).toContain("createImageBitmap");
    expect(code).toContain("imageOrientationTransform");
    expect(code).not.toMatch(/document\.|Bun\.|https?:\/\//);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 20000);
