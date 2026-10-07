import { verifyEffectProvenance } from "./effects-provenance";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "vite";
import viteConfig from "../vite.config";
import { createManifest, isTarget, targets } from "./manifest";
import { inspectDirectory } from "./inspection";
import { outputDirectory, root } from "./paths";

await verifyEffectProvenance(root);
const requested = Bun.argv[2];
if (requested !== undefined && !isTarget(requested)) {
  throw new Error("Usage: bun tooling/build.ts [chromium|firefox]");
}
for (const target of requested === undefined ? targets : [requested]) {
  const outDir = outputDirectory(target);
  await build({
    ...viteConfig,
    configFile: false,
    root,
    build: { ...viteConfig.build, outDir, emptyOutDir: true },
  });
  await mkdir(outDir, { recursive: true });
  await writeFile(
    resolve(outDir, "manifest.json"),
    `${JSON.stringify(createManifest(target), null, 2)}\n`,
  );
  await copyFile(
    resolve(root, "THIRD_PARTY_NOTICES.md"),
    resolve(outDir, "THIRD_PARTY_NOTICES.md"),
  );
  await copyFile(
    resolve(root, "tooling/licenses/svelte-LICENSE.txt"),
    resolve(outDir, "SVELTE_LICENSE.txt"),
  );
  console.log(
    `${target}: inspected ${String((await inspectDirectory(outDir, target)).length)} files`,
  );
}
