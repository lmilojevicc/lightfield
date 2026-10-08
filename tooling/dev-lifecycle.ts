import { access, mkdtemp, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export async function discoverBinary(
  browser: "chromium" | "firefox",
  env = process.env,
): Promise<string> {
  const key =
    browser === "chromium" ? "LIGHTFIELD_CHROMIUM_BINARY" : "LIGHTFIELD_FIREFOX_BINARY";
  const override = env[key];
  const names =
    browser === "chromium"
      ? ["chromium", "chromium-browser", "chrome-for-testing"]
      : ["firefox"];
  const candidates = override
    ? [override]
    : [
        ...names.flatMap((name) =>
          (env.PATH ?? "")
            .split(process.platform === "win32" ? ";" : ":")
            .map((dir) =>
              join(dir, process.platform === "win32" ? `${name}.exe` : name),
            ),
        ),
        ...(process.platform === "darwin"
          ? browser === "chromium"
            ? [
                "/Applications/Chromium.app/Contents/MacOS/Chromium",
                "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
              ]
            : ["/Applications/Firefox.app/Contents/MacOS/firefox"]
          : []),
        ...(process.platform === "win32"
          ? [
              join(
                env.PROGRAMFILES ?? "C:\\Program Files",
                browser === "chromium"
                  ? "Chromium/Application/chrome.exe"
                  : "Mozilla Firefox/firefox.exe",
              ),
            ]
          : []),
      ];
  for (const path of candidates) {
    try {
      await access(path, constants.X_OK);
      if (browser === "chromium") {
        // Even a mistaken executable override must never reuse a normal profile.
        const probe = await mkdtemp(join(tmpdir(), "lightfield-browser-probe-"));
        try {
          const child = Bun.spawn(
            [path, "--headless=new", `--user-data-dir=${probe}`, "--version"],
            {
              stdout: "pipe",
              stderr: "ignore",
              timeout: 5000,
            },
          );
          const version = await new Response(child.stdout).text();
          if (
            (await child.exited) !== 0 ||
            !/Chromium|Chrome for Testing/i.test(version)
          )
            continue;
        } finally {
          await rm(probe, { recursive: true, force: true });
        }
      }
      return path;
    } catch {
      /* Try the next installed candidate. */
    }
  }
  throw new Error(
    `Missing compatible ${browser}. Set ${key} to an executable${browser === "chromium" ? " for Chromium or Chrome for Testing (regular Google Chrome is not supported)" : " for Firefox"}. No browser is downloaded.`,
  );
}

export function firefoxArguments(
  profile: string,
  port: number,
  headless: boolean,
): string[] {
  return [
    "-no-remote",
    "-new-instance",
    "-foreground",
    "-profile",
    profile,
    "-start-debugger-server",
    String(port),
    ...(headless ? ["--headless"] : []),
    "about:blank",
  ];
}

// Bound protocol waits and release their timer/listener on every outcome. The
// owner handles abort/timeout by closing the corresponding process and transport.
export function waitForBrowser<T>(
  work: Promise<T>,
  label: string,
  signal?: AbortSignal,
  timeout = 10_000,
): Promise<T> {
  let clean = () => {};
  return new Promise<T>((resolve, reject) => {
    const aborted = () => {
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new Error(`${label} cancelled`),
      );
    };
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${String(timeout)}ms`));
    }, timeout);
    signal?.addEventListener("abort", aborted, { once: true });
    clean = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
    };
    if (signal?.aborted) aborted();
    work.then(resolve, reject);
  }).finally(() => {
    clean();
  });
}

// One trailing rebuild absorbs edits during a build; failures do not stop watching.
export class RebuildQueue {
  private dirty = false;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active: Promise<void> | undefined;
  constructor(
    private readonly rebuild: () => Promise<void>,
    private readonly report: (error: unknown) => void,
    private readonly delay = 150,
  ) {}
  request() {
    if (this.stopped) return;
    this.dirty = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.start();
    }, this.delay);
  }
  private start() {
    if (this.active || this.stopped) return;
    this.active = this.drain().finally(() => {
      this.active = undefined;
      if (this.dirty && !this.stopped) this.start();
    });
  }
  private async drain() {
    while (this.dirty && !this.stopped) {
      this.dirty = false;
      try {
        await this.rebuild();
      } catch (error) {
        this.report(error);
      }
    }
  }
  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.active;
  }
}
