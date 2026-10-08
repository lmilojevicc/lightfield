import { expect, test } from "bun:test";
import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  rename,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DevelopmentInputs } from "./dev-inputs";
import { RebuildQueue } from "./dev-lifecycle";

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lightfield-inputs-test-"));
  const source = resolve(root, "src/input.css");
  await mkdir(resolve(root, "src"));
  await writeFile(source, "original");
  return {
    root,
    source,
    inputs: new DevelopmentInputs(root, ["src", "public", "config.json"]),
  };
}

test("content gate ignores copies, metadata and generated files; detects source/config additions, edits and removals", async () => {
  const { root, source, inputs } = await fixture();
  try {
    expect(await inputs.changed()).toBe(true);
    expect(await inputs.changed()).toBe(false);
    await copyFile(source, resolve(root, "output.css"));
    await utimes(source, new Date(), new Date());
    await writeFile(source, "original");
    for (const directory of [
      "node_modules",
      "dist",
      ".vite",
      ".svelte-kit",
      "coverage",
      ".git",
    ]) {
      await mkdir(resolve(root, directory));
      await writeFile(resolve(root, directory, "generated"), "noise");
    }
    expect(await inputs.changed()).toBe(false);
    await writeFile(source, "modified");
    expect(await inputs.changed()).toBe(true);
    expect(await inputs.changed()).toBe(false);
    await writeFile(resolve(root, "config.json"), "{}");
    expect(await inputs.changed()).toBe(true);
    await mkdir(resolve(root, "public"));
    const asset = resolve(root, "public", "asset.bin");
    await writeFile(asset, new Uint8Array([1, 2, 3]));
    expect(await inputs.changed()).toBe(true);
    await writeFile(asset, new Uint8Array([3, 2, 1]));
    expect(await inputs.changed()).toBe(true);
    await rm(source);
    expect(await inputs.changed()).toBe(true);
    await writeFile(source, "recreated");
    expect(await inputs.changed()).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("content gate fingerprints nested public assets and source paths regardless of directory basename", async () => {
  const { root, inputs } = await fixture();
  try {
    await inputs.changed();
    for (const input of ["public", "src"]) {
      for (const directory of [
        "dist",
        "node_modules",
        ".vite",
        ".svelte-kit",
        "coverage",
        ".git",
      ]) {
        const nested = resolve(root, input, directory);
        await mkdir(nested, { recursive: true });
        const file = resolve(nested, "example.txt");
        await writeFile(file, "added");
        expect(await inputs.changed()).toBe(true);
        expect(await inputs.changed()).toBe(false);
        await writeFile(file, "edited");
        expect(await inputs.changed()).toBe(true);
        const renamed = resolve(nested, "renamed.txt");
        await rename(file, renamed);
        expect(await inputs.changed()).toBe(true);
        expect(await inputs.changed()).toBe(false);
        await rm(renamed);
        expect(await inputs.changed()).toBe(true);
        expect(await inputs.changed()).toBe(false);
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("pre-build gate preserves edits during active builds, serializes and recovers after failure", async () => {
  const { root, source, inputs } = await fixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let builds = 0;
  let concurrent = 0;
  let maximum = 0;
  const errors: unknown[] = [];
  const queue = new RebuildQueue(
    async () => {
      if (!(await inputs.changed())) return;
      builds++;
      concurrent++;
      maximum = Math.max(maximum, concurrent);
      try {
        if (builds === 1) {
          await gate;
          throw new Error("compile failure");
        }
      } finally {
        concurrent--;
      }
    },
    (error) => {
      errors.push(error);
    },
    1,
  );
  async function until(predicate: () => boolean) {
    for (let i = 0; i < 200 && !predicate(); i++) await Bun.sleep(5);
    expect(predicate()).toBe(true);
  }
  try {
    await inputs.changed();
    await writeFile(source, "first edit");
    queue.request();
    await until(() => builds === 1);
    await writeFile(source, "edit while building");
    for (let i = 0; i < 20; i++) queue.request();
    await Bun.sleep(20);
    expect(builds).toBe(1);
    release();
    await until(() => builds === 2);
    expect(errors).toHaveLength(1);
    expect(maximum).toBe(1);
    queue.request();
    await Bun.sleep(30);
    expect(builds).toBe(2);
    expect(await inputs.changed()).toBe(false);
  } finally {
    release();
    await queue.stop();
    await rm(root, { recursive: true, force: true });
  }
});
