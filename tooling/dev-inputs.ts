import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Root build/cache/dependency outputs are outside this explicit input list.
// Every nested path inside an input remains observable, including public/dist.
export const developmentInputs = [
  "src",
  "public",
  "tooling",
  "vite.config.ts",
  "svelte.config.js",
  "package.json",
  "bun.lock",
  "newtab.html",
  "THIRD_PARTY_NOTICES.md",
  "tsconfig.app.json",
  "tsconfig.base.json",
];

// Bun's macOS copyFile can emit source-side change events with unchanged bytes
// and metadata. Compare build inputs, not filesystem notifications or mtimes.
export class DevelopmentInputs {
  private previous = new Map<string, string>();
  constructor(
    private readonly root: string,
    private readonly inputs = developmentInputs,
  ) {}
  async changed(): Promise<boolean> {
    const current = new Map<string, string>();
    const visit = async (path: string): Promise<void> => {
      try {
        const entries = await readdir(path, { withFileTypes: true });
        for (const entry of entries) {
          await visit(resolve(path, entry.name));
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        if ((error as NodeJS.ErrnoException).code !== "ENOTDIR") throw error;
        try {
          current.set(
            path,
            createHash("sha256")
              .update(await readFile(path))
              .digest("hex"),
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    };
    for (const input of this.inputs) await visit(resolve(this.root, input));
    const changed =
      current.size !== this.previous.size ||
      [...current].some(([path, hash]) => this.previous.get(path) !== hash);
    // Advance before compilation, never after: an edit during compilation must
    // remain different when the queue drains its next request, even on failure.
    this.previous = current;
    return changed;
  }
}
