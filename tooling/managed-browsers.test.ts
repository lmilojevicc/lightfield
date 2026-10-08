import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  Browser,
  BrowserPlatform,
  computeExecutablePath,
} from "@puppeteer/browsers";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
  utimes,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import lockfile from "proper-lockfile";
import {
  browserCache,
  browserPins,
  managedPlatform,
  resolveManagedBinary,
} from "./managed-browsers";

async function rejects(work: Promise<unknown>, message?: string) {
  const error: unknown = await work.catch((error: unknown) => error);
  expect(error).toBeInstanceOf(Error);
  if (message) expect(String(error)).toContain(message);
}

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "lightfield-managed-test-"));
  const env = {
    HOME: home,
    USERPROFILE: home,
    LOCALAPPDATA: home,
    XDG_CACHE_HOME: home,
  };
  const signal = new AbortController().signal;
  const cache = browserCache(env);
  let installs = 0;
  const installer = async (
    target: keyof typeof browserPins,
    stage: string,
    platform: BrowserPlatform,
  ) => {
    installs++;
    await sleep(30);
    const executable = computeExecutablePath({
      cacheDir: stage,
      browser: target === "chromium" ? Browser.CHROME : Browser.FIREFOX,
      platform,
      buildId: browserPins[target],
    });
    await mkdir(dirname(executable), { recursive: true });
    await writeFile(
      executable,
      `#!/bin/sh\necho '${target === "chromium" ? "Google Chrome for Testing 151.0.7922.47" : "Mozilla Firefox 157.0.1"}'\n`,
    );
    await chmod(executable, 0o700);
  };
  return {
    home,
    env,
    signal,
    cache,
    installer,
    installs: () => installs,
    clean: () => rm(home, { recursive: true, force: true }),
  };
}

test("pins are explicit official build IDs and platform support is bounded", () => {
  expect(browserPins).toEqual({
    chromium: "151.0.7922.47",
    firefox: "stable_157.0.1",
  });
  expect(managedPlatform("darwin", "arm64")).toBe(BrowserPlatform.MAC_ARM);
  expect(managedPlatform("darwin", "x64")).toBe(BrowserPlatform.MAC);
  expect(managedPlatform("linux", "x64")).toBe(BrowserPlatform.LINUX);
  expect(managedPlatform("win32", "x64")).toBe(BrowserPlatform.WIN64);
  expect(() => managedPlatform("linux", "arm64")).toThrow(
    "do not support linux/arm64",
  );
  expect(() => managedPlatform("darwin", "ia32")).toThrow("do not support");
});

test.skipIf(process.platform === "win32")(
  "cache miss publishes validated pins; cache hit invokes no installer",
  async () => {
    const f = await fixture();
    try {
      for (const target of ["chromium", "firefox"] as const) {
        const first = await resolveManagedBinary(
          target,
          f.signal,
          f.env,
          f.installer,
        );
        expect(first.startsWith(f.cache)).toBe(true);
        expect(first).not.toContain(".install-");
        const second = await resolveManagedBinary(
          target,
          f.signal,
          f.env,
          () => {
            throw new Error("network forbidden");
          },
        );
        expect(second).toBe(first);
      }
      expect(f.installs()).toBe(2);
      expect(
        (await readdir(f.cache)).filter(
          (name) => name.startsWith(".install-") || name.endsWith(".lock"),
        ),
      ).toEqual([]);
    } finally {
      await f.clean();
    }
  },
);

test.skipIf(process.platform === "win32")(
  "concurrent requests install once and reuse atomic publication",
  async () => {
    const f = await fixture();
    try {
      const paths = await Promise.all(
        Array.from({ length: 4 }, () =>
          resolveManagedBinary("chromium", f.signal, f.env, f.installer),
        ),
      );
      expect(new Set(paths).size).toBe(1);
      expect(f.installs()).toBe(1);
    } finally {
      await f.clean();
    }
  },
);

test.skipIf(process.platform === "win32")(
  "corrupt executable and partial publication fail without downloads or unrelated deletion",
  async () => {
    const f = await fixture();
    try {
      const path = await resolveManagedBinary(
        "chromium",
        f.signal,
        f.env,
        f.installer,
      );
      await writeFile(path, "corrupt");
      await rejects(
        resolveManagedBinary("chromium", f.signal, f.env, f.installer),
        "checksum differs",
      );
      const partial = join(
        f.cache,
        `${managedPlatform()}-firefox-${browserPins.firefox}`,
      );
      await mkdir(partial);
      await writeFile(join(f.cache, "unrelated"), "keep");
      await rejects(
        resolveManagedBinary("firefox", f.signal, f.env, f.installer),
        "Remove only this directory",
      );
      expect(f.installs()).toBe(1);
      expect(await readdir(f.cache)).toContain("unrelated");
    } finally {
      await f.clean();
    }
  },
);

test("strict overrides bypass cache/platform but never silently fall back", async () => {
  const f = await fixture();
  try {
    await rejects(
      resolveManagedBinary(
        "chromium",
        f.signal,
        { ...f.env, LIGHTFIELD_CHROMIUM_BINARY: "/missing" },
        f.installer,
      ),
      "LIGHTFIELD_CHROMIUM_BINARY",
    );
    await rejects(
      resolveManagedBinary(
        "firefox",
        f.signal,
        { ...f.env, LIGHTFIELD_FIREFOX_BINARY: "" },
        f.installer,
      ),
      "nonempty",
    );
    expect(f.installs()).toBe(0);
  } finally {
    await f.clean();
  }
});

test.skipIf(process.platform === "win32")(
  "failed and cancelled installs remove stages and locks; retry succeeds",
  async () => {
    const f = await fixture();
    try {
      await rejects(
        resolveManagedBinary(
          "chromium",
          f.signal,
          f.env,
          async (_target, stage) => {
            await writeFile(join(stage, "partial-download"), "partial");
            throw new Error("offline fixture");
          },
        ),
        "Connect to the internet and retry",
      );
      expect(await readdir(f.cache)).toEqual([]);
      const cancel = new AbortController();
      await rejects(
        resolveManagedBinary(
          "chromium",
          cancel.signal,
          f.env,
          async (_target, stage, _platform, signal) => {
            await writeFile(join(stage, "partial-download"), "partial");
            cancel.abort(new Error("cancelled download"));
            signal.throwIfAborted();
          },
        ),
        "cancelled download",
      );
      expect(await readdir(f.cache)).toEqual([]);
      await resolveManagedBinary("chromium", f.signal, f.env, f.installer);
      const already = new AbortController();
      already.abort(new Error("cancelled before provisioning"));
      await rejects(
        resolveManagedBinary("chromium", already.signal, f.env, f.installer),
        "before provisioning",
      );
      expect(f.installs()).toBe(1);
    } finally {
      await f.clean();
    }
  },
);

test("cancels waiting for another installer without deleting its lock", async () => {
  const f = await fixture();
  const entry = join(
    f.cache,
    `${managedPlatform()}-chromium-${browserPins.chromium}`,
  );
  await mkdir(f.cache, { recursive: true });
  const release = await lockfile.lock(entry, { realpath: false });
  try {
    const cancel = new AbortController();
    const pending = resolveManagedBinary(
      "chromium",
      cancel.signal,
      f.env,
      f.installer,
    );
    setTimeout(() => {
      cancel.abort(new Error("cancel wait"));
    }, 20);
    await rejects(pending);
    expect(await lockfile.check(entry, { realpath: false })).toBe(true);
    expect(f.installs()).toBe(0);
  } finally {
    await release();
    await f.clean();
  }
});

test.skipIf(process.platform === "win32")(
  "stale interrupted install lock recovers without executing abandoned stage",
  async () => {
    const f = await fixture();
    const entry = join(
      f.cache,
      `${managedPlatform()}-chromium-${browserPins.chromium}`,
    );
    try {
      await mkdir(`${entry}.lock`, { recursive: true });
      const old = new Date(Date.now() - 120_000);
      await utimes(`${entry}.lock`, old, old);
      const abandoned = join(f.cache, ".install-abandoned");
      await mkdir(abandoned);
      await writeFile(join(abandoned, "partial"), "never execute");
      await resolveManagedBinary("chromium", f.signal, f.env, f.installer);
      expect(f.installs()).toBe(1);
      expect(await readdir(f.cache)).toContain(".install-abandoned");
      expect(await readdir(f.cache)).not.toContain(
        `${managedPlatform()}-chromium-${browserPins.chromium}.lock`,
      );
    } finally {
      await f.clean();
    }
  },
);

test.skipIf(process.platform === "win32")(
  "managed installs reject compatible but mismatched exact versions; explicit overrides remain compatible",
  async () => {
    const f = await fixture();
    try {
      for (const target of ["chromium", "firefox"] as const) {
        let mismatched = "";
        await rejects(
          resolveManagedBinary(
            target,
            f.signal,
            f.env,
            async (name, stage, platform) => {
              await f.installer(name, stage, platform);
              mismatched = computeExecutablePath({
                cacheDir: stage,
                browser: name === "chromium" ? Browser.CHROME : Browser.FIREFOX,
                platform,
                buildId: browserPins[name],
              });
              const source = await readFile(mismatched, "utf8");
              await writeFile(
                mismatched,
                source.replace(
                  name === "chromium" ? "151.0.7922.47" : "157.0.1",
                  name === "chromium" ? "151.0.7922.48" : "157.0.2",
                ),
              );
              const key =
                name === "chromium"
                  ? "LIGHTFIELD_CHROMIUM_BINARY"
                  : "LIGHTFIELD_FIREFOX_BINARY";
              expect(
                await resolveManagedBinary(name, f.signal, {
                  ...f.env,
                  [key]: mismatched,
                }),
              ).toBe(mismatched);
            },
          ),
          "version mismatch",
        );
        expect(await readdir(f.cache)).toEqual([]);
      }
    } finally {
      await f.clean();
    }
  },
);

test.skipIf(process.platform === "win32")(
  "managed cache rejects mismatched version even with a matching executable marker",
  async () => {
    const f = await fixture();
    try {
      const path = await resolveManagedBinary(
        "chromium",
        f.signal,
        f.env,
        f.installer,
      );
      await writeFile(
        path,
        (await readFile(path, "utf8")).replace(
          "151.0.7922.47",
          "151.0.7922.48",
        ),
      );
      const entry = join(
        f.cache,
        `${managedPlatform()}-chromium-${browserPins.chromium}`,
      );
      await writeFile(
        join(entry, "complete.sha256"),
        createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
      );
      await rejects(
        resolveManagedBinary("chromium", f.signal, f.env, () => {
          throw new Error("must not download");
        }),
        "version mismatch",
      );
      expect(f.installs()).toBe(1);
      expect(
        await resolveManagedBinary("chromium", f.signal, {
          ...f.env,
          LIGHTFIELD_CHROMIUM_BINARY: path,
        }),
      ).toBe(path);
    } finally {
      await f.clean();
    }
  },
);
