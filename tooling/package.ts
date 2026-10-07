import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { inspectArchive, inspectDirectory } from "./inspection";
import { targets } from "./manifest";
import { archivePath, outputDirectory } from "./paths";

for (const target of targets) {
  const directory = outputDirectory(target);
  const archive = archivePath(target);
  await inspectDirectory(directory, target);
  await mkdir(dirname(archive), { recursive: true });
  await rm(archive, { force: true });
  const zip = Bun.spawn(["zip", "-q", "-r", archive, "."], {
    cwd: directory,
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await zip.exited) !== 0) throw new Error(`ZIP failed: ${target}`);
  await inspectArchive(archive, directory, target);
  console.log(
    `${target}: inspected local archive ${archive} (NOT release-ready)`,
  );
}
