import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { Target } from "./manifest";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const outputDirectory = (target: Target) =>
  resolve(root, "dist", target);
export const archivePath = (target: Target) =>
  resolve(root, "artifacts", `lightfield-${target}.zip`);
