import { access, lstat, realpath } from "node:fs/promises";
import {
  isAbsolute,
  basename,
  dirname,
  relative,
  resolve,
  sep,
} from "node:path";

type Image = {
  "image-path"?: string;
  "system-entities"?: { "dev-entry"?: string }[];
};

function withinStage(path: string, stage: string): boolean {
  const inside = relative(stage, resolve(path));
  return (
    Boolean(inside) &&
    inside !== ".." &&
    !inside.startsWith(`..${sep}`) &&
    !isAbsolute(inside)
  );
}

// Missing components must not hide ownership through an alternate alias. Only
// reconstruct a candidate for classification, never to select a detach device.
async function resolveFromExistingAncestor(path: string): Promise<string> {
  let ancestor = dirname(path);
  for (;;) {
    try {
      return resolve(await realpath(ancestor), relative(ancestor, path));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      const exists = await lstat(ancestor).then(
        () => true,
        (failure: unknown) => {
          const missing = (failure as NodeJS.ErrnoException).code;
          if (missing !== "ENOENT" && missing !== "ENOTDIR") throw failure;
          return false;
        },
      );
      // A dangling/otherwise unresolvable existing alias is uncertain, not foreign.
      if (exists) throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
}

// Component containment excludes sibling stages and unrelated user volumes.
export function ownedDmgDevices(
  images: Image[],
  canonicalStage: string,
): string[] {
  return images.flatMap((image) => {
    const path = image["image-path"];
    if (!path || !isAbsolute(path)) return [];
    if (!withinStage(path, canonicalStage)) return [];
    const devices = (image["system-entities"] ?? []).flatMap((entity) =>
      entity["dev-entry"]?.match(/^\/dev\/disk\d+(?:s\d+)*$/)
        ? [entity["dev-entry"]]
        : [],
    );
    const root = devices.sort((a, b) => a.length - b.length)[0];
    if (!root)
      throw new Error("Cannot identify device for owned mounted image");
    // Detaching any partition detaches the whole image; use its root device.
    return [root];
  });
}

async function command(args: string[], input?: string): Promise<string> {
  const child = Bun.spawn(args, {
    stdin: input === undefined ? "ignore" : new Blob([input]),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 5000,
    killSignal: "SIGKILL",
  });
  const [output, error] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if ((await child.exited) !== 0)
    throw new Error(`${String(args[0])} failed: ${error}`);
  return output;
}

export async function releaseOwnedDmg(
  stage: string,
  run = command,
): Promise<void> {
  try {
    await access(stage);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const canonical = await realpath(stage);
  try {
    const info = await run(["hdiutil", "info", "-plist"]);
    const data = JSON.parse(
      await run(["plutil", "-convert", "json", "-o", "-", "-"], info),
    ) as { images?: Image[] };
    if (!Array.isArray(data.images))
      throw new Error("Cannot establish mounted image ownership");
    const images = await Promise.all(
      data.images.map(async (image) => {
        const path = image["image-path"];
        if (!path || !isAbsolute(path)) return { ...image, "image-path": "" };
        // An image may use a different alias than either stage spelling. Resolve
        // its parent before deciding ownership; the archive itself may be gone.
        try {
          return {
            ...image,
            "image-path": resolve(
              await realpath(dirname(path)),
              basename(path),
            ),
          };
        } catch (error) {
          if (withinStage(path, resolve(stage)) || withinStage(path, canonical))
            throw error;
          const candidate = await resolveFromExistingAncestor(path);
          if (withinStage(candidate, canonical)) throw error;
          // Established foreign images are neither logged nor detached. An owned
          // candidate with missing components instead retains/reports the stage.
          return { ...image, "image-path": "" };
        }
      }),
    );
    const devices = ownedDmgDevices(images, canonical);
    for (const device of new Set(devices))
      await run(["hdiutil", "detach", device, "-quiet"]);
  } catch (error) {
    throw new Error(
      `Could not confirm/release owned installer DMG. Retained stage ${canonical}; inspect this image with hdiutil info and detach it before removing this directory, then retry. No unrelated volumes were detached.`,
      { cause: error },
    );
  }
}
