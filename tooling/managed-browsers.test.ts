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
  rename,
  rm,
  symlink,
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
  disableManagedFirefoxUpdates,
  managedPlatform,
  resolveManagedBinary,
} from "./managed-browsers";

async function rejects(work: Promise<unknown>, message?: string) {
  const error: unknown = await work.catch((error: unknown) => error);
  expect(error).toBeInstanceOf(Error);
  if (message) expect(String(error)).toContain(message);
}

function firefoxPolicyPath(executable: string, platform = managedPlatform()) {
  return join(
    dirname(executable),
    ...(platform === BrowserPlatform.MAC || platform === BrowserPlatform.MAC_ARM
      ? ["..", "Resources"]
      : []),
    "distribution",
    "policies.json",
  );
}

async function fixture(requireFirefoxPolicy = false) {
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
    if (target === "firefox")
      await mkdir(dirname(dirname(firefoxPolicyPath(executable, platform))), {
        recursive: true,
      });
    const policyCheck =
      target === "firefox" && requireFirefoxPolicy
        ? `grep -q '"DisableAppUpdate": true' "$(dirname "$0")/${platform === BrowserPlatform.MAC || platform === BrowserPlatform.MAC_ARM ? "../Resources/" : ""}distribution/policies.json" || exit 42\n`
        : "";
    await writeFile(
      executable,
      `#!/bin/sh\n${policyCheck}echo '${target === "chromium" ? "Google Chrome for Testing 151.0.7922.47" : "Mozilla Firefox 157.0.1"}'\n`,
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

test("managed Firefox policy uses the official app layout on every supported platform", async () => {
  const f = await fixture();
  try {
    for (const platform of [
      BrowserPlatform.MAC_ARM,
      BrowserPlatform.MAC,
      BrowserPlatform.LINUX,
      BrowserPlatform.WIN64,
    ]) {
      const entry = join(f.home, platform);
      const executable = computeExecutablePath({
        cacheDir: entry,
        browser: Browser.FIREFOX,
        platform,
        buildId: browserPins.firefox,
      });
      const app = join(entry, "firefox", `${platform}-${browserPins.firefox}`);
      const policy = join(
        app,
        ...(platform === BrowserPlatform.MAC ||
        platform === BrowserPlatform.MAC_ARM
          ? ["Firefox.app", "Contents", "Resources"]
          : [platform === BrowserPlatform.LINUX ? "firefox" : "core"]),
        "distribution",
        "policies.json",
      );
      expect(firefoxPolicyPath(executable, platform)).toBe(policy);
      await mkdir(dirname(dirname(policy)), { recursive: true });
      await disableManagedFirefoxUpdates(entry, platform, f.signal);
      expect(JSON.parse(await readFile(policy, "utf8"))).toEqual({
        policies: { DisableAppUpdate: true },
      });
    }
  } finally {
    await f.clean();
  }
});

test.skipIf(process.platform === "win32")(
  "managed Firefox disables updates before fresh and legacy-cache probes without changing the digest",
  async () => {
    const f = await fixture(true);
    try {
      const binary = await resolveManagedBinary(
        "firefox",
        f.signal,
        f.env,
        f.installer,
      );
      const policy = firefoxPolicyPath(binary);
      const entry = join(
        f.cache,
        `${managedPlatform()}-firefox-${browserPins.firefox}`,
      );
      const marker = await readFile(join(entry, "complete.sha256"), "utf8");
      expect(marker).toBe(
        createHash("sha256")
          .update(await readFile(binary))
          .digest("hex"),
      );
      await rm(dirname(policy), { recursive: true });
      const paths = await Promise.all(
        Array.from({ length: 3 }, () =>
          resolveManagedBinary("firefox", f.signal, f.env, () => {
            throw new Error("legacy cache must not redownload");
          }),
        ),
      );
      expect(paths).toEqual([binary, binary, binary]);
      expect(JSON.parse(await readFile(policy, "utf8"))).toEqual({
        policies: { DisableAppUpdate: true },
      });
      expect(await readFile(join(entry, "complete.sha256"), "utf8")).toBe(
        marker,
      );
      expect(await readdir(dirname(policy))).toEqual(["policies.json"]);
      expect(
        (await readdir(f.cache)).some((name) => name.endsWith(".lock")),
      ).toBe(false);
      expect(f.installs()).toBe(1);
    } finally {
      await f.clean();
    }
  },
);

test.skipIf(process.platform === "win32")(
  "managed Firefox preserves custom settings and rejects malformed policies without overwriting them",
  async () => {
    const f = await fixture(true);
    try {
      const binary = await resolveManagedBinary(
        "firefox",
        f.signal,
        f.env,
        f.installer,
      );
      const policy = firefoxPolicyPath(binary);
      const custom = {
        comment: "keep",
        policies: { DisableTelemetry: true, DisableAppUpdate: false },
      };
      await writeFile(policy, JSON.stringify(custom));
      await resolveManagedBinary("firefox", f.signal, f.env, f.installer);
      expect(JSON.parse(await readFile(policy, "utf8"))).toEqual({
        ...custom,
        policies: { ...custom.policies, DisableAppUpdate: true },
      });
      const unchanged = await readFile(policy, "utf8");
      await resolveManagedBinary("firefox", f.signal, f.env, f.installer);
      expect(await readFile(policy, "utf8")).toBe(unchanged);
      for (const malformed of [
        "{",
        "null",
        "[]",
        "{}",
        '{"policies":[]}',
        '{"policies":{"DisableAppUpdate":"true"}}',
      ]) {
        await writeFile(policy, malformed);
        await rejects(
          resolveManagedBinary("firefox", f.signal, f.env, f.installer),
          "Could not disable managed Firefox application updates",
        );
        expect(await readFile(policy, "utf8")).toBe(malformed);
      }
      expect(f.installs()).toBe(1);
    } finally {
      await f.clean();
    }
  },
);

test.skipIf(process.platform === "win32")(
  "managed Firefox refuses policy symlinks and write failures without touching external files",
  async () => {
    const f = await fixture();
    try {
      const binary = await resolveManagedBinary(
        "firefox",
        f.signal,
        f.env,
        f.installer,
      );
      const policy = firefoxPolicyPath(binary);
      const outside = join(f.home, "outside");
      await mkdir(outside);
      const externalPolicy = join(outside, "policies.json");
      await writeFile(externalPolicy, "external");
      await rm(policy);
      await symlink(externalPolicy, policy);
      await rejects(
        resolveManagedBinary("firefox", f.signal, f.env, f.installer),
        "not a symlink",
      );
      await rm(dirname(policy), { recursive: true });
      await symlink(outside, dirname(policy));
      await rejects(
        resolveManagedBinary("firefox", f.signal, f.env, f.installer),
        "not a symlink",
      );
      await rm(dirname(policy));
      await mkdir(dirname(policy));
      await chmod(dirname(policy), 0o500);
      try {
        await rejects(
          resolveManagedBinary("firefox", f.signal, f.env, f.installer),
          "cache permissions",
        );
      } finally {
        await chmod(dirname(policy), 0o700);
      }
      const entry = join(
        f.cache,
        `${managedPlatform()}-firefox-${browserPins.firefox}`,
      );
      const moved = join(f.home, "moved-entry");
      await rename(entry, moved);
      await symlink(moved, entry);
      await rejects(
        resolveManagedBinary("firefox", f.signal, f.env, f.installer),
        "not a symlink",
      );
      expect(await readdir(dirname(policy))).toEqual([]);
      expect(await readFile(externalPolicy, "utf8")).toBe("external");
      expect(await readdir(outside)).toEqual(["policies.json"]);
      expect(f.installs()).toBe(1);
    } finally {
      await f.clean();
    }
  },
);

test.skipIf(process.platform === "win32")(
  "managed Firefox validates checksum before policy migration and still rejects version drift",
  async () => {
    const f = await fixture(true);
    try {
      const binary = await resolveManagedBinary(
        "firefox",
        f.signal,
        f.env,
        f.installer,
      );
      const policy = firefoxPolicyPath(binary);
      await rm(policy);
      await writeFile(
        binary,
        (await readFile(binary, "utf8")).replace("157.0.1", "158.0"),
      );
      await rejects(
        resolveManagedBinary("firefox", f.signal, f.env, f.installer),
        "checksum differs",
      );
      expect(await readdir(dirname(policy))).toEqual([]);
      const entry = join(
        f.cache,
        `${managedPlatform()}-firefox-${browserPins.firefox}`,
      );
      await writeFile(
        join(entry, "complete.sha256"),
        createHash("sha256")
          .update(await readFile(binary))
          .digest("hex"),
      );
      await rejects(
        resolveManagedBinary("firefox", f.signal, f.env, f.installer),
        "version mismatch: expected 157.0.1, got 158.0",
      );
      expect(f.installs()).toBe(1);
    } finally {
      await f.clean();
    }
  },
);

test.skipIf(process.platform === "win32")(
  "Chromium and explicit Firefox overrides never receive managed Firefox policies",
  async () => {
    const f = await fixture();
    try {
      const chromium = await resolveManagedBinary(
        "chromium",
        f.signal,
        f.env,
        f.installer,
      );
      expect(await readdir(dirname(chromium))).not.toContain("distribution");
      const external = join(f.home, "external");
      await f.installer("firefox", external, managedPlatform());
      const binary = computeExecutablePath({
        cacheDir: external,
        browser: Browser.FIREFOX,
        platform: managedPlatform(),
        buildId: browserPins.firefox,
      });
      const policy = firefoxPolicyPath(binary);
      await mkdir(dirname(policy));
      await writeFile(policy, "custom external policy, do not parse or modify");
      expect(
        await resolveManagedBinary(
          "firefox",
          f.signal,
          { ...f.env, LIGHTFIELD_FIREFOX_BINARY: binary },
          f.installer,
        ),
      ).toBe(binary);
      expect(await readFile(policy, "utf8")).toBe(
        "custom external policy, do not parse or modify",
      );
      expect(await readdir(f.cache)).toEqual([
        `${managedPlatform()}-chromium-${browserPins.chromium}`,
      ]);
    } finally {
      await f.clean();
    }
  },
);

test.skipIf(process.platform === "win32")(
  "Firefox policy migration waits for the cache lock and cancellation leaves legacy policy untouched",
  async () => {
    const f = await fixture(true);
    let release: (() => Promise<void>) | undefined;
    try {
      const binary = await resolveManagedBinary(
        "firefox",
        f.signal,
        f.env,
        f.installer,
      );
      const policy = firefoxPolicyPath(binary);
      await rm(policy);
      const entry = join(
        f.cache,
        `${managedPlatform()}-firefox-${browserPins.firefox}`,
      );
      release = await lockfile.lock(entry, { realpath: false });
      const cancel = new AbortController();
      const pending = resolveManagedBinary(
        "firefox",
        cancel.signal,
        f.env,
        f.installer,
      );
      setTimeout(() => {
        cancel.abort(new Error("cancel policy migration"));
      }, 20);
      await rejects(pending, "operation was aborted");
      expect(await readdir(dirname(policy))).toEqual([]);
      expect(await lockfile.check(entry, { realpath: false })).toBe(true);
    } finally {
      await release?.();
      await f.clean();
    }
  },
);

test.skipIf(process.platform === "win32")(
  "cancelled Firefox staging never probes or publishes an unprotected executable",
  async () => {
    const f = await fixture(true);
    try {
      const cancel = new AbortController();
      await rejects(
        resolveManagedBinary(
          "firefox",
          cancel.signal,
          f.env,
          async (target, stage, platform) => {
            await f.installer(target, stage, platform);
            cancel.abort(new Error("cancel before policy"));
          },
        ),
        "cancel before policy",
      );
      expect(await readdir(f.cache)).toEqual([]);
      await resolveManagedBinary("firefox", f.signal, f.env, f.installer);
      expect(f.installs()).toBe(2);
    } finally {
      await f.clean();
    }
  },
);
