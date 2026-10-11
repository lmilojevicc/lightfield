import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  SEARCH_ENGINES,
  engineIconPath,
  engineIconSource,
} from "../../../src/ui/shell/search-engines";

// The component renders engineIconPath(); asserting the helper here keeps the fast
// gate coupled to the shipped path, and knip catches a component that stops using it.
// Each shipped hash and upstream icon name must also appear in the notices, so the
// provenance record can never silently drift from the files in the repository.
for (const { id } of SEARCH_ENGINES) {
  test(`EngineIcon asset: ${id} has a colour SVG with a viewBox`, async () => {
    const svg = await readFile(`public/${engineIconPath(id)}`, "utf8");
    expect(svg.trim().length).toBeGreaterThan(0);
    expect(svg).toMatch(/^\s*<svg\b[^>]*\bviewBox="[^"]+"/);
    expect(svg).not.toMatch(/currentColor/i);
    const notices = await readFile("THIRD_PARTY_NOTICES.md", "utf8");
    expect(notices).toContain(engineIconSource(id));
    expect(notices).toContain(createHash("sha256").update(svg).digest("hex"));
  });
}
