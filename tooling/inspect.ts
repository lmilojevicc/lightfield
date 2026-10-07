import { inspectDirectory } from "./inspection";
import { targets } from "./manifest";
import { outputDirectory } from "./paths";

for (const target of targets) {
  const files = await inspectDirectory(outputDirectory(target), target);
  console.log(
    `${target}: valid scaffold package (${String(files.length)} files)`,
  );
}
