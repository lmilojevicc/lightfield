import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { createManifest, targets } from "./manifest";

const asset = (name: string) =>
  readFile(new URL(`../public/icons/${name}`, import.meta.url));

test("both manifests reference correctly sized RGBA shader icon exports", async () => {
  for (const target of targets) {
    const manifest = createManifest(target);
    for (const size of [16, 32, 48, 128] as const) {
      expect(manifest.icons[size]).toBe(`icons/icon-${String(size)}.png`);
      const png = await asset(`icon-${String(size)}.png`);
      expect(png.subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
      expect(png.subarray(12, 16).toString()).toBe("IHDR");
      expect(png.readUInt32BE(16)).toBe(size);
      expect(png.readUInt32BE(20)).toBe(size);
      expect(png[24]).toBe(8);
      expect(png[25]).toBe(6);
    }
  }
});

test("adapted shader master keeps upstream geometry and the approved thicker stroke", async () => {
  const master = (await asset("icon.svg")).toString();
  const source = (await asset("sources/shader.svg")).toString();
  const geometry = (svg: string) => /\bd="([^"]+)"/.exec(svg)?.[1];
  expect(geometry(source)).toBeDefined();
  expect(geometry(master)).toBe(geometry(source));
  expect(master).toContain('viewBox="0 0 256 256"');
  expect(master).toContain('rx="56" fill="#F4F3EE"');
  expect(master).toContain('transform="translate(48 48) scale(10)"');
  expect(master).toContain('fill="none" stroke="#242523" stroke-width="1.25"');
  expect(master).toContain('stroke-linecap="round" stroke-linejoin="round"');
  expect(master.match(/<path\b/g)).toHaveLength(1);
});

test("the shipped notice includes the complete retained shader artwork license", async () => {
  const license = (await asset("LICENSE.txt")).toString();
  const notices = await readFile(
    new URL("../THIRD_PARTY_NOTICES.md", import.meta.url),
    "utf8",
  );
  expect(license).toContain("Copyright (c) 2023 Catppuccin");
  expect(license).toContain("Copyright (c) 2023 thang-nm");
  expect(notices).toContain(license);
});
