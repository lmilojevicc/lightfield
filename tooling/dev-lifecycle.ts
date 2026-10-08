import { access, mkdtemp, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export async function discoverBinary(
  browser: "chromium" | "firefox",
  env = process.env,
  signal?: AbortSignal,
  expectedVersion?: string,
): Promise<string> {
  const key =
    browser === "chromium" ? "LIGHTFIELD_CHROMIUM_BINARY" : "LIGHTFIELD_FIREFOX_BINARY";
  const override = env[key];
  if (override) {
    signal?.throwIfAborted();
    try {
      await access(override, constants.X_OK);
      // Even a mistaken override must never reuse a normal profile.
      const probe = await mkdtemp(join(tmpdir(), "lightfield-browser-probe-"));
      try {
        const child = Bun.spawn(
          [
            override,
            ...(browser === "chromium"
              ? ["--headless=new", `--user-data-dir=${probe}`]
              : ["--headless", "-no-remote", "-profile", probe]),
            "--version",
          ],
          {
            stdout: "pipe",
            stderr: "pipe",
            env: { ...process.env, ...env, MOZ_HEADLESS: "1" },
            timeout: 15000,
            killSignal: "SIGKILL",
          },
        );
        const abort = () => {
          child.kill("SIGKILL");
        };
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
        try {
          const [version, diagnostics] = await Promise.all([
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
          ]);
          if ((await child.exited) !== 0)
            throw new Error(
              `Version probe failed (exit ${String(child.exitCode)}, signal ${String(child.signalCode)}): ${diagnostics}`,
            );
          signal?.throwIfAborted();
          if (
            browser === "chromium"
              ? !/Chromium|Chrome for Testing/i.test(version)
              : !/Firefox (\d+)/.test(version) ||
                Number(/Firefox (\d+)/.exec(version)?.[1]) < 140
          )
            throw new Error(`Incompatible version: ${version.trim()}`);
          if (expectedVersion) {
            const actual = (
              browser === "chromium"
                ? /(?:Chromium|Chrome for Testing)\s+(\d+(?:\.\d+)+)/i
                : /Firefox\s+(\d+(?:\.\d+)+)/
            ).exec(version)?.[1];
            if (actual !== expectedVersion)
              throw new Error(
                `Managed ${browser} version mismatch: expected ${expectedVersion}, got ${actual ?? "unparseable version"}`,
              );
          }
          return override;
        } finally {
          signal?.removeEventListener("abort", abort);
        }
      } finally {
        await rm(probe, { recursive: true, force: true });
      }
    } catch (error) {
      signal?.throwIfAborted();
      throw new Error(
        `Missing compatible ${browser}. Invalid ${key}: ${override}. ${browser === "chromium" ? "Use Chromium or Chrome for Testing; regular Google Chrome is not supported." : "Use Firefox 140+."} Check OS libraries/sandbox prerequisites. ${String(error)}`,
        { cause: error },
      );
    }
  }
  throw new Error(
    `Missing compatible ${browser}. ${key} must be a nonempty executable path; no installed-browser fallback.`,
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
