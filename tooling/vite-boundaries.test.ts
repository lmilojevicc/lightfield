import { expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import viteConfig from "../vite.config";

test("Vite emits a local ES module worker and keeps a literal effect import lazy", async () => {
  const root = await mkdtemp(join(tmpdir(), "lightfield-vite-test-"));
  try {
    await writeFile(
      join(root, "newtab.html"),
      '<script type="module" src="./main.ts"></script>',
    );
    await writeFile(
      join(root, "main.ts"),
      `
      const worker = new Worker(new URL('./decode.worker.ts', import.meta.url), { type: 'module' });
      worker.postMessage('decode');
      document.addEventListener('click', async () => { const effect = await import('./effect.ts'); effect.paint(); });
    `,
    );
    await writeFile(
      join(root, "decode.worker.ts"),
      'export {}; self.onmessage = () => self.postMessage("LIGHTFIELD_LOCAL_WORKER");',
    );
    await writeFile(
      join(root, "effect.ts"),
      'export function paint() { console.log("LIGHTFIELD_LAZY_EFFECT"); }',
    );
    await build({
      ...viteConfig,
      configFile: false,
      root,
      logLevel: "silent",
      build: { ...viteConfig.build, outDir: "dist", minify: false },
    });
    const assetDirectory = join(root, "dist/assets");
    const assets = await readdir(assetDirectory);
    const workerPath = assets.find(
      (path) => path.startsWith("decode.worker-") && path.endsWith(".js"),
    );
    const effectPath = assets.find(
      (path) => path.startsWith("effect-") && path.endsWith(".js"),
    );
    const mainPath = assets.find(
      (path) => path.startsWith("newtab-") && path.endsWith(".js"),
    );
    expect(workerPath).toBeDefined();
    expect(effectPath).toBeDefined();
    expect(mainPath).toBeDefined();
    if (!workerPath || !effectPath || !mainPath)
      throw new Error("Missing fixture chunks");
    const main = await readFile(join(assetDirectory, mainPath), "utf8");
    const worker = await readFile(join(assetDirectory, workerPath), "utf8");
    const effect = await readFile(join(assetDirectory, effectPath), "utf8");
    expect(main).toContain('type: "module"');
    expect(main).toContain(workerPath);
    expect(main).toContain(`import("./${effectPath}")`);
    expect(main).not.toContain("LIGHTFIELD_LAZY_EFFECT");
    expect(main).not.toMatch(/blob:|data:|https?:\/\//);
    expect(worker).toContain("LIGHTFIELD_LOCAL_WORKER");
    expect(effect).toContain("LIGHTFIELD_LAZY_EFFECT");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 20000);
