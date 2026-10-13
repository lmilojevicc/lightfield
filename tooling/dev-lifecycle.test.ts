import { describe, expect, test } from "bun:test";
import {
  access,
  mkdtemp,
  readFile,
  rm,
  writeFile,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverBinary,
  firefoxArguments,
  RebuildQueue,
} from "./dev-lifecycle";

async function until(predicate: () => boolean) {
  for (let i = 0; i < 100 && !predicate(); i++) await Bun.sleep(5);
  expect(predicate()).toBe(true);
}

describe("developer browser lifecycle", () => {
  test("Firefox arguments isolate the owned profile, port and headless instance", () => {
    const args = firefoxArguments("/owned/profile", 43210, true);
    expect(args).toEqual([
      "-no-remote",
      "-new-instance",
      "-foreground",
      "-profile",
      "/owned/profile",
      "-start-debugger-server",
      "43210",
      "--headless",
      "about:blank",
    ]);
    expect(firefoxArguments("/owned/profile", 43210, false)).not.toContain(
      "--headless",
    );
  });
  test("missing explicit binaries fail actionably without falling back", () => {
    expect(
      discoverBinary("firefox", {
        LIGHTFIELD_FIREFOX_BINARY: "/does-not-exist",
      }),
    ).rejects.toThrow("LIGHTFIELD_FIREFOX_BINARY");
    expect(
      discoverBinary("chromium", {
        LIGHTFIELD_CHROMIUM_BINARY: "/does-not-exist",
      }),
    ).rejects.toThrow("regular Google Chrome is not supported");
  });
  test.skipIf(process.platform === "win32")(
    "rejects branded Chrome even through an override",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "lightfield-binary-test-"));
      const binary = join(dir, "chrome");
      try {
        await writeFile(binary, "#!/bin/sh\necho 'Google Chrome 151.0.0.0'\n");
        await chmod(binary, 0o700);
        expect(
          discoverBinary("chromium", { LIGHTFIELD_CHROMIUM_BINARY: binary }),
        ).rejects.toThrow("Missing compatible chromium");
        await writeFile(
          binary,
          "#!/bin/sh\necho 'Google Chrome for Testing 151.0.0.0'\n",
        );
        expect(
          await discoverBinary("chromium", {
            LIGHTFIELD_CHROMIUM_BINARY: binary,
          }),
        ).toBe(binary);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
  test("coalesces a burst and serializes one trailing rebuild", async () => {
    let calls = 0;
    let concurrent = 0;
    let maximum = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queue = new RebuildQueue(
      async () => {
        calls++;
        concurrent++;
        maximum = Math.max(maximum, concurrent);
        if (calls === 1) await gate;
        concurrent--;
      },
      () => {},
      5,
    );
    queue.request();
    queue.request();
    queue.request();
    await until(() => calls === 1);
    for (let i = 0; i < 20; i++) queue.request();
    await Bun.sleep(15);
    expect(calls).toBe(1);
    release();
    await until(() => calls === 2);
    await queue.stop();
    expect(maximum).toBe(1);
  });
  test("reports failed builds and recovers on the next edit", async () => {
    let calls = 0;
    const errors: unknown[] = [];
    const queue = new RebuildQueue(
      () => {
        calls++;
        return calls === 1
          ? Promise.reject(new Error("compile error"))
          : Promise.resolve();
      },
      (error) => {
        errors.push(error);
      },
      1,
    );
    queue.request();
    await until(() => errors.length === 1);
    queue.request();
    await until(() => calls === 2);
    await queue.stop();
    expect(errors).toHaveLength(1);
  });
  test("stop cancels pending edits and waits for active work", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queue = new RebuildQueue(
      async () => {
        calls++;
        await gate;
      },
      () => {},
      1,
    );
    queue.request();
    await until(() => calls === 1);
    queue.request();
    let finished = false;
    const stopping = queue.stop().then(() => {
      finished = true;
    });
    await Bun.sleep(10);
    expect(finished).toBe(false);
    release();
    await stopping;
    queue.request();
    await Bun.sleep(10);
    expect(calls).toBe(1);
  });
});

test.skipIf(process.platform === "win32")(
  "version probe hard timeout kills a SIGTERM-ignoring owned child and removes its profile",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "lightfield-probe-timeout-test-"));
    const binary = join(dir, "fixture");
    const record = join(dir, "record.json");
    await writeFile(
      binary,
      `#!${process.execPath}
import {writeFileSync} from 'node:fs';
process.on('SIGTERM', () => {});
const args = process.argv.slice(2);
if (!args.includes('--headless') || !args.includes('--version') || process.env.MOZ_HEADLESS !== '1') process.exit(90);
writeFileSync(process.env.LIGHTFIELD_PROBE_RECORD, JSON.stringify({pid: process.pid, profile: args[args.indexOf('-profile') + 1]}));
setInterval(() => {}, 1000);
`,
    );
    await chmod(binary, 0o700);
    const start = Date.now();
    try {
      const error = await discoverBinary("firefox", {
        LIGHTFIELD_FIREFOX_BINARY: binary,
        LIGHTFIELD_PROBE_RECORD: record,
      }).catch((error: unknown) => error);
      expect(String(error)).toContain("Version probe failed");
      expect(Date.now() - start).toBeGreaterThanOrEqual(14000);
      expect(Date.now() - start).toBeLessThan(20000);
      const owned = JSON.parse(await readFile(record, "utf8")) as {
        pid: number;
        profile: string;
      };
      expect(() => process.kill(owned.pid, 0)).toThrow();
      expect(
        await access(owned.profile).then(
          () => true,
          () => false,
        ),
      ).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  25000,
);
