import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ownedDmgDevices, releaseOwnedDmg } from "./managed-dmg";

test("DMG ownership excludes foreign and sibling-prefix paths; picks owned root device", () => {
  const image = (path: string, disk: string) => ({
    "image-path": path,
    "system-entities": [{ "dev-entry": `${disk}s1` }, { "dev-entry": disk }],
  });
  expect(
    ownedDmgDevices(
      [
        image("/cache/.stage/firefox/archive.dmg", "/dev/disk10"),
        image("/cache/.stage-other/archive.dmg", "/dev/disk11"),
        image("/foreign/archive.dmg", "/dev/disk12"),
        image("/cache/.stage/../foreign/archive.dmg", "/dev/disk13"),
        image("relative/archive.dmg", "/dev/disk14"),
      ],
      "/cache/.stage",
    ),
  ).toEqual(["/dev/disk10"]);
  expect(() =>
    ownedDmgDevices(
      [{ "image-path": "/cache/.stage/archive.dmg" }],
      "/cache/.stage",
    ),
  ).toThrow("Cannot identify device");
});

test("DMG cleanup detaches only owned image without force; failures retain stage", async () => {
  const stage = await mkdtemp(join(tmpdir(), "lightfield-dmg-test-"));
  const canonical = await realpath(stage);
  const calls: string[][] = [];
  const info = JSON.stringify({
    images: [
      {
        "image-path": join(canonical, "owned.dmg"),
        "system-entities": [{ "dev-entry": "/dev/disk123" }],
      },
      {
        "image-path": "/foreign/image.dmg",
        "system-entities": [{ "dev-entry": "/dev/disk124" }],
      },
    ],
  });
  const run = (args: string[]) => {
    calls.push(args);
    return Promise.resolve(info);
  };
  try {
    await releaseOwnedDmg(stage, run);
    expect(calls.filter((args) => args.includes("detach"))).toEqual([
      ["hdiutil", "detach", "/dev/disk123", "-quiet"],
    ]);
    const failure = await releaseOwnedDmg(stage, (args) =>
      args.includes("detach")
        ? Promise.reject(new Error("busy volume"))
        : Promise.resolve(info),
    ).catch((error: unknown) => error);
    expect(String(failure)).toContain("Retained stage");
    expect(await realpath(stage)).toBe(canonical);
    const unknown = await releaseOwnedDmg(stage, () =>
      Promise.resolve("{}"),
    ).catch((error: unknown) => error);
    expect(String(unknown)).toContain("Retained stage");
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
});

test("DMG cleanup resolves supplied and alternate stage aliases before ownership", async () => {
  const home = await mkdtemp(join(tmpdir(), "lightfield-dmg-alias-test-"));
  const stage = join(home, "stage");
  const alias = join(home, "alias");
  const alternate = join(home, "alternate");
  await mkdir(stage);
  await symlink(stage, alias, "dir");
  await symlink(stage, alternate, "dir");
  const canonical = await realpath(stage);
  const calls: string[][] = [];
  try {
    const images = [
      {
        "image-path": join(alias, "owned.dmg"),
        "system-entities": [{ "dev-entry": "/dev/disk101" }],
      },
      {
        "image-path": join(alternate, "owned.dmg"),
        "system-entities": [{ "dev-entry": "/dev/disk102" }],
      },
      {
        "image-path": join(canonical, "owned.dmg"),
        "system-entities": [{ "dev-entry": "/dev/disk103" }],
      },
      {
        "image-path": join(home, "stage-sibling", "foreign.dmg"),
        "system-entities": [{ "dev-entry": "/dev/disk104" }],
      },
      {
        "image-path": "/missing/foreign.dmg",
        "system-entities": [{ "dev-entry": "/dev/disk105" }],
      },
    ];
    // macOS's /var -> /private/var alias is also exercised when present.
    if (canonical.startsWith("/private/var/"))
      images.push({
        "image-path": join(canonical.slice("/private".length), "owned.dmg"),
        "system-entities": [{ "dev-entry": "/dev/disk106" }],
      });
    await releaseOwnedDmg(alias, (args) => {
      calls.push(args);
      return Promise.resolve(JSON.stringify({ images }));
    });
    expect(calls.filter((args) => args.includes("detach"))).toEqual(
      images
        .filter(
          (image) =>
            !["/dev/disk104", "/dev/disk105"].includes(
              image["system-entities"][0]?.["dev-entry"] ?? "",
            ),
        )
        .map((image) => [
          "hdiutil",
          "detach",
          String(image["system-entities"][0]?.["dev-entry"]),
          "-quiet",
        ]),
    );
    const uncertain = join(home, "dangling-alias");
    await symlink(join(home, "missing-target"), uncertain, "dir");
    for (const candidate of [alias, alternate, uncertain]) {
      const unresolvedCalls: string[][] = [];
      const unresolved = await releaseOwnedDmg(alias, (args) => {
        unresolvedCalls.push(args);
        return Promise.resolve(
          JSON.stringify({
            images: [
              {
                "image-path": join(candidate, "missing-parent", "owned.dmg"),
                "system-entities": [{ "dev-entry": "/dev/disk107" }],
              },
            ],
          }),
        );
      }).catch((error: unknown) => error);
      expect(String(unresolved)).toContain("Retained stage");
      expect(await realpath(stage)).toBe(canonical);
      expect(unresolvedCalls.filter((args) => args.includes("detach"))).toEqual(
        [],
      );
    }
    const busy = await releaseOwnedDmg(alias, (args) =>
      args.includes("detach")
        ? Promise.reject(new Error("busy"))
        : Promise.resolve(JSON.stringify({ images: [images[0]] })),
    ).catch((error: unknown) => error);
    expect(String(busy)).toContain("Retained stage");
    expect(await realpath(stage)).toBe(canonical);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
