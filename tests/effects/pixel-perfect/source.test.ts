import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import provenance from "../../../src/effects/pixel-perfect/provenance.json";
import {
  VERTEX as waveVertex,
  FRAGMENT as waveFragment,
} from "../../../src/effects/pixel-perfect/dither-wave-shaders";
import {
  VERTEX as contourVertex,
  FRAGMENT as contourFragment,
} from "../../../src/effects/pixel-perfect/contour-map-shaders";
import { PIXEL_PERFECT_IDS } from "../../../src/shared/pixel-perfect-metadata";
import { BACKGROUND_COLLECTIONS } from "../../../src/shared/background-metadata";

test("Pixel Perfect reference fixtures retain their pinned upstream bytes; shaders are unchanged", async () => {
  expect(provenance.commit).toBe("951c461ed18b750f0edcc4cb0fc26eecb6f45691");
  for (const file of provenance.files.filter(
    (file) =>
      file.name === "dither-wave.tsx.fixture" ||
      file.name === "contour-map.tsx.fixture",
  )) {
    const source = await Bun.file(
      new URL(
        `../../../tests/effects/pixel-perfect/fixtures/${file.name}`,
        import.meta.url,
      ),
    ).text();
    expect(createHash("sha256").update(source).digest("hex")).toBe(file.sha256);
    const wave = file.name.startsWith("dither-wave");
    expect(source.match(/const VERTEX = `([\s\S]*?)`;/)?.[1]).toBe(
      wave ? waveVertex : contourVertex,
    );
    expect(source.match(/const FRAGMENT = `([\s\S]*?)`;/)?.[1]).toBe(
      wave ? waveFragment : contourFragment,
    );
  }
});
test("all six Pixel Perfect backgrounds have exclusive collection ownership and bundled WebP previews", async () => {
  for (const id of PIXEL_PERFECT_IDS) {
    expect(
      BACKGROUND_COLLECTIONS.filter((collection) =>
        collection.ids.includes(id),
      ).map((collection) => collection.id),
    ).toEqual(["pixel-perfect"]);
    const bytes = new Uint8Array(
      await Bun.file(
        new URL(`../../../public/previews/${id}.webp`, import.meta.url),
      ).arrayBuffer(),
    );
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(bytes.subarray(8, 12))).toBe("WEBP");
    expect(bytes.length).toBeGreaterThan(1000);
  }
});
