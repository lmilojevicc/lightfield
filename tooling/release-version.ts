import { resolve } from "node:path";
import { outputDirectory, root } from "./paths";

function versionOf(metadata: unknown): unknown {
  return typeof metadata === "object" &&
    metadata !== null &&
    "version" in metadata
    ? metadata.version
    : undefined;
}

export function releaseVersion(
  packageMetadata: unknown,
  chromiumManifest: unknown,
  firefoxManifest: unknown,
): string {
  const version = versionOf(packageMetadata);
  if (
    typeof version !== "string" ||
    !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version) ||
    version !== version.trim()
  ) {
    throw new Error("package.json version must be strict X.Y.Z");
  }
  for (const [target, manifest] of [
    ["chromium", chromiumManifest],
    ["firefox", firefoxManifest],
  ] as const) {
    if (versionOf(manifest) !== version) {
      throw new Error(
        `${target} built manifest version differs from package.json`,
      );
    }
  }
  return version;
}

if (import.meta.main) {
  console.log(
    releaseVersion(
      await Bun.file(resolve(root, "package.json")).json(),
      await Bun.file(
        resolve(outputDirectory("chromium"), "manifest.json"),
      ).json(),
      await Bun.file(
        resolve(outputDirectory("firefox"), "manifest.json"),
      ).json(),
    ),
  );
}
