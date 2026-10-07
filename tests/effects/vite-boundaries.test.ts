import { expect, test } from "bun:test";
import { mkdtemp, writeFile, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "vite";
import viteConfig from "../../vite.config";

test("real controller/native composition emits lazy engines, local Paper noise and static module worker", async () => {
  const root = await mkdtemp(join(tmpdir(), "lightfield-effect-boundary-"));
  try {
    await writeFile(
      join(root, "newtab.html"),
      '<script type="module" src="./main.ts"></script>',
    );
    await writeFile(
      join(root, "main.ts"),
      `
      import { BackgroundController } from ${JSON.stringify(resolve("src/effects/runtime/controller.ts"))};
      import { createServices } from ${JSON.stringify(resolve("src/services/create-services.ts"))};
      globalThis.mountLightfieldBackground = host => {
        const services = createServices();
        return new BackgroundController(host, {
          activity: services.activity, images: services.images,
          reducedMotion: () => services.reducedMotion(),
          subscribeReducedMotion: listener => services.subscribeReducedMotion(listener),
          resolveAsset: path => new URL(path, document.baseURI).href,
        });
      };
    `,
    );
    const result = await build({
      ...viteConfig,
      configFile: false,
      root,
      publicDir: false,
      logLevel: "silent",
      build: { ...viteConfig.build, outDir: "dist", minify: false },
    });
    const directory = join(root, "dist/assets"),
      files = await readdir(directory);
    const mainPath = files.find(
      (path) => path.startsWith("newtab-") && path.endsWith(".js"),
    );
    const workerPath = files.find(
      (path) =>
        path.startsWith("local-image-decode.worker-") && path.endsWith(".js"),
    );
    if (!mainPath || !workerPath)
      throw new Error("Real controller composition entry/worker missing");
    const main = await readFile(join(directory, mainPath), "utf8");
    expect(main).toContain('type: "module"');
    expect(main).toContain(workerPath);
    const lazyPaths = [...main.matchAll(/import\("\.\/([^"]+\.js)"\)/g)].map(
      (match) => match[1],
    );
    expect(new Set(lazyPaths).size).toBeGreaterThan(40);
    for (const path of lazyPaths) {
      if (!path) throw new Error("Missing lazy chunk path");
      expect(files).toContain(path);
    }
    const outputs = Array.isArray(result) ? result : [result];
    const chunks = outputs.flatMap((output) => {
      if (!("output" in output)) throw new Error("Unexpected watch build");
      return output.output.filter((file) => file.type === "chunk");
    });
    const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
    const eager = new Set<string>();
    const pending = [`assets/${mainPath}`];
    while (pending.length) {
      const name = pending.pop();
      if (!name || eager.has(name)) continue;
      const chunk = byName.get(name);
      if (!chunk) throw new Error(`Missing static dependency chunk: ${name}`);
      eager.add(name);
      pending.push(...chunk.imports);
      for (const id of Object.keys(chunk.modules)) {
        expect(id).not.toMatch(/\/src\/vendor\/(?:neat|orbs)\//);
        expect(id).not.toMatch(
          /\/node_modules\/(?:three|postprocessing|ogl|@paper-design\/shaders)\//,
        );
        expect(id).not.toMatch(
          /\/src\/effects\/(?:paper\/shader-mount|neat\/preset-adapter)\.ts$/,
        );
      }
    }
    expect(eager.size).toBeGreaterThan(0);
    const modules = await Promise.all(
      files
        .filter((path) => path.endsWith(".js") && path !== mainPath)
        .map((path) => readFile(join(directory, path), "utf8")),
    );
    const engines = modules.join("\n");
    expect(engines).toContain("Neat Gradients v");
    expect(engines).toContain("1.0.2");
    expect(engines).toContain("1.0.3-canary.20260731173236");
    expect(engines).toContain("Paper Shaders");
    expect(engines).toContain(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIA",
    );
    expect(engines).not.toMatch(/https?:\/\/[^\s"']+\.(?:png|jpe?g|webp)/i);
    const worker = await readFile(join(directory, workerPath), "utf8");
    expect(worker).toContain("createImageBitmap");
    expect(worker).not.toMatch(/document\.|Bun\.|https?:\/\//);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
