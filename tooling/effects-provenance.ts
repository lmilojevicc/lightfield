import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import ledger from "./effects-provenance.json";

/** Source snapshot bytes: quarantined engines, upstream fixtures, previews/fonts/icons. */
export async function verifyEffectProvenance(root: string): Promise<number> {
  for (const entry of ledger) {
    const bytes = await readFile(resolve(root, entry.path));
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hash !== entry.sha256)
      throw new Error(`Effect provenance drift: ${entry.path}`);
  }
  return ledger.length;
}
