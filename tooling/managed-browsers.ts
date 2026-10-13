import {
  Browser,
  BrowserPlatform,
  computeExecutablePath,
  install,
} from "@puppeteer/browsers";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import lockfile from "proper-lockfile";
import { releaseOwnedDmg } from "./managed-dmg";
import { discoverBinary } from "./dev-lifecycle";

// Exact official build IDs: Firefox releases require the stable_ prefix.
export const browserPins = {
  chromium: "151.0.7922.47",
  firefox: "stable_157.0.1",
} as const;
type Target = keyof typeof browserPins;

export function managedPlatform(
  os = process.platform,
  arch = process.arch,
): BrowserPlatform {
  if (os === "darwin" && arch === "arm64") return BrowserPlatform.MAC_ARM;
  if (os === "darwin" && arch === "x64") return BrowserPlatform.MAC;
  if (os === "linux" && arch === "x64") return BrowserPlatform.LINUX;
  if (os === "win32" && arch === "x64") return BrowserPlatform.WIN64;
  throw new Error(
    `Managed browsers do not support ${os}/${arch}. Supported: macOS arm64/x64, Linux x64, Windows x64. Supply both LIGHTFIELD_CHROMIUM_BINARY and LIGHTFIELD_FIREFOX_BINARY for a compatible custom setup.`,
  );
}

export function browserCache(env = process.env): string {
  const home = env.HOME ?? env.USERPROFILE ?? homedir();
  const base =
    process.platform === "darwin"
      ? join(home, "Library", "Caches")
      : process.platform === "win32"
        ? (env.LOCALAPPDATA ?? join(home, "AppData", "Local"))
        : (env.XDG_CACHE_HOME ?? join(home, ".cache"));
  return resolve(base, "lightfield", "browsers");
}

async function digest(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path))
    hash.update(chunk as Buffer);
  return hash.digest("hex");
}

// Installer has no cancellation or install lock API. Isolate it (including
// extraction children) in an owned process group; only publish completed stages.
function installChild(
  target: Target,
  stage: string,
  platform: BrowserPlatform,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  return new Promise((done, fail) => {
    const child = spawn(
      process.execPath,
      [import.meta.filename, "--install", target, stage, platform],
      { stdio: "inherit", detached: process.platform !== "win32" },
    );
    const kill = () => {
      if (!child.pid) return;
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
        }).unref();
      } else {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* Already exited. */
        }
      }
    };
    const timer = setTimeout(kill, 300_000);
    signal.addEventListener("abort", kill, { once: true });
    child.once("error", fail);
    child.once("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", kill);
      if (signal.aborted)
        fail(
          signal.reason instanceof Error
            ? signal.reason
            : new Error("Provisioning cancelled"),
        );
      else if (code !== 0)
        fail(
          new Error(
            `Installer exited ${String(code)} (download/extraction timeout is 5 minutes)`,
          ),
        );
      else done();
    });
  });
}

export async function resolveManagedBinary(
  target: Target,
  signal: AbortSignal,
  env = process.env,
  installer = installChild,
): Promise<string> {
  const lockCancellation = new AbortController();
  signal = AbortSignal.any([signal, lockCancellation.signal]);
  signal.throwIfAborted();
  const key =
    target === "chromium"
      ? "LIGHTFIELD_CHROMIUM_BINARY"
      : "LIGHTFIELD_FIREFOX_BINARY";
  if (env[key] !== undefined) return discoverBinary(target, env, signal);
  const platform = managedPlatform();
  const browser = target === "chromium" ? Browser.CHROME : Browser.FIREFOX;
  const buildId = browserPins[target];
  const expectedVersion = buildId.replace(/^stable_/, "");
  const cache = browserCache(env);
  const entry = join(cache, `${platform}-${target}-${buildId}`);
  const binary = (dir: string) =>
    computeExecutablePath({ cacheDir: dir, browser, buildId, platform });
  const cached = async (): Promise<string | undefined> => {
    try {
      await access(entry);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    try {
      const expected = await readFile(join(entry, "complete.sha256"), "utf8");
      if (expected !== (await digest(binary(entry))))
        throw new Error("executable checksum differs");
      signal.throwIfAborted();
      await discoverBinary(
        target,
        { ...env, [key]: binary(entry) },
        signal,
        expectedVersion,
      );
      console.log(`lightfield: cached ${target} ${buildId} (${entry})`);
      return binary(entry);
    } catch (error) {
      signal.throwIfAborted();
      throw new Error(
        `Corrupt or unusable managed ${target} cache at ${entry}. Remove only this directory and retry online. Check browser OS libraries/sandbox prerequisites. ${String(error)}`,
        { cause: error },
      );
    }
  };
  const hit = await cached();
  if (hit) return hit;
  await mkdir(cache, { recursive: true });
  // Heartbeat-based stale recovery is supplied by proper-lockfile; lock files
  // are per pin/platform, never locks or deletes unrelated cache directories.
  let release: (() => Promise<void>) | undefined;
  const deadline = Date.now() + 360_000;
  while (!release) {
    signal.throwIfAborted();
    try {
      release = await lockfile.lock(entry, {
        realpath: false,
        stale: 60_000,
        update: 10_000,
        onCompromised: (error) => {
          lockCancellation.abort(error);
        },
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ELOCKED") throw error;
      if (Date.now() > deadline)
        throw new Error(
          `Timed out waiting for browser install lock ${entry}. Retry after the other launcher finishes.`,
          { cause: error },
        );
      await sleep(200, undefined, { signal });
    }
  }
  let stage: string | undefined;
  try {
    signal.throwIfAborted();
    const shared = await cached();
    if (shared) return shared;
    stage = await mkdtemp(join(cache, `.install-${platform}-${target}-`));
    console.log(
      `lightfield: downloading ${target} ${buildId} into ${cache}. First run needs network and archive extraction tools; Linux also needs browser system libraries.`,
    );
    await installer(target, stage, platform, signal);
    await discoverBinary(
      target,
      { ...env, [key]: binary(stage) },
      signal,
      expectedVersion,
    );
    await writeFile(
      join(stage, "complete.sha256"),
      await digest(binary(stage)),
    );
    signal.throwIfAborted();
    await rename(stage, entry);
    stage = undefined;
    console.log(`lightfield: installed ${target} ${buildId}`);
    return binary(entry);
  } catch (error) {
    signal.throwIfAborted();
    throw new Error(
      `Could not provision ${target} ${buildId} in ${cache}. Connect to the internet and retry; check cache permissions and extraction tools (macOS hdiutil, Linux unzip/xz, Windows tar). No system packages are installed. Optional ${key} must point to a compatible executable. ${String(error)}`,
      { cause: error },
    );
  } finally {
    try {
      if (stage) {
        if (target === "firefox" && process.platform === "darwin") {
          await releaseOwnedDmg(stage).catch((error: unknown) => {
            // The launcher treats explicit cancellation as successful shutdown;
            // still report a retained mount/stage that needs manual recovery.
            console.error(error);
            throw error;
          });
        }
        await rm(stage, { recursive: true, force: true });
      }
    } finally {
      await release();
    }
  }
}

if (import.meta.main && Bun.argv[2] === "--install") {
  const target = Bun.argv[3] as Target;
  const cacheDir = Bun.argv[4];
  const platform = Object.values(BrowserPlatform).find(
    (value) => value === Bun.argv[5],
  );
  if (!(target in browserPins) || !cacheDir || !platform)
    throw new Error("Invalid owned installer arguments");
  await install({
    cacheDir,
    platform,
    browser: target === "chromium" ? Browser.CHROME : Browser.FIREFOX,
    buildId: browserPins[target],
    installDeps: false,
    downloadProgressCallback: (() => {
      let last = -1;
      return (downloaded: number, total: number) => {
        const bucket =
          total > 0
            ? Math.floor((downloaded / total) * 10)
            : Math.floor(downloaded / 10_000_000);
        if (bucket <= last) return;
        last = bucket;
        console.log(
          `lightfield: ${target} download ${String(Math.round(downloaded / 1_000_000))}MB${total > 0 ? ` / ${String(Math.round(total / 1_000_000))}MB (${String(Math.min(bucket * 10, 100))}%)` : ""}`,
        );
      };
    })(),
  });
}
