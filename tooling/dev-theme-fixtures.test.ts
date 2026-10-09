import { expect, spyOn, test } from "bun:test";
import { runInNewContext } from "node:vm";
import {
  devThemeFixtures,
  seedDevThemes,
  seedDevThemesExpression,
} from "./dev-theme-fixtures";
import {
  CUSTOM_THEMES_KEY,
  validateCustomThemes,
  hexContrastRatio,
} from "../src/domain/themes/custom-themes";
import {
  DEFAULT_SETTINGS,
  STORAGE_KEY,
  SETTINGS_WRITE_LOCK_NAME,
} from "../src/domain/settings/schema";

test("dev fixtures use valid unique custom-theme colors and names", () => {
  expect(validateCustomThemes(devThemeFixtures)).toEqual(devThemeFixtures);
  expect(new Set(devThemeFixtures.map((theme) => theme.id)).size).toBe(3);
  expect(
    devThemeFixtures.every((theme) => theme.id.startsWith("custom:dev-")),
  ).toBe(true);
  expect(devThemeFixtures[2]?.name.length).toBeGreaterThan(30);
  expect(new Set(devThemeFixtures.map((theme) => theme.accent)).size).toBe(3);
  expect(
    devThemeFixtures.map((theme) =>
      hexContrastRatio(theme.paper, "#000000") >
      hexContrastRatio(theme.paper, "#ffffff")
        ? "Light"
        : "Dark",
    ),
  ).toEqual(["Dark", "Light", "Dark"]);
});

for (const existing of [undefined, [], [{ id: "custom:existing" }]]) {
  test(`fixture seed preserves presence ${JSON.stringify(existing)} and selection`, async () => {
    const selected =
      existing === undefined ? DEFAULT_SETTINGS.theme : "custom:user-selected";
    const values: Record<string, unknown> = {
      [STORAGE_KEY]: { theme: selected },
    };
    if (existing !== undefined) values[CUSTOM_THEMES_KEY] = existing;
    let writes = 0;
    const context = {
      browser: {
        storage: {
          local: {
            get: (key: string) =>
              Promise.resolve(
                Object.hasOwn(values, key) ? { [key]: values[key] } : {},
              ),
            set: (update: Record<string, unknown>) => {
              writes++;
              Object.assign(values, update);
              return Promise.resolve();
            },
          },
        },
      },
      navigator: {
        locks: {
          request: async (
            key: string,
            _options: unknown,
            work: () => Promise<void>,
          ) => {
            expect(key).toBe(SETTINGS_WRITE_LOCK_NAME);
            await work();
          },
        },
      },
    };
    const evaluate = (expression: string): Promise<unknown> =>
      Promise.resolve(runInNewContext(expression, context) as unknown);
    await seedDevThemes(evaluate, new AbortController().signal);
    await seedDevThemes(evaluate, new AbortController().signal);
    expect(values[CUSTOM_THEMES_KEY]).toEqual(existing ?? devThemeFixtures);
    expect(writes).toBe(existing === undefined ? 1 : 0);
    expect(values[STORAGE_KEY]).toEqual({ theme: selected });
  });
}

test("seed reports async storage failure instead of readiness", () => {
  const context = { browser: { storage: { local: {} } }, navigator: {} };
  expect(
    seedDevThemes(
      (expression) =>
        Promise.resolve(runInNewContext(expression, context) as unknown),
      new AbortController().signal,
    ),
  ).rejects.toThrow("settings lock unavailable");
  expect(seedDevThemesExpression).not.toContain("settings:");
});

test("pending fixture marker abort preserves the cancellation reason", async () => {
  const cancellation = new AbortController();
  const reason = new Error("cancel pending fixture seed");
  let release!: (value: unknown) => void;
  let polling!: () => void;
  const pending = new Promise<unknown>((resolve) => {
    release = resolve;
  });
  const pollStarted = new Promise<void>((resolve) => {
    polling = resolve;
  });
  let calls = 0;
  const outcome = seedDevThemes((expression) => {
    calls++;
    if (expression === seedDevThemesExpression) return Promise.resolve(true);
    polling();
    return pending;
  }, cancellation.signal).catch((error: unknown) => error);
  await pollStarted;
  cancellation.abort(reason);
  // The launcher supplies abort-aware protocol evaluation. Settle this unit
  // double to exercise the loop's own abort check after a pending reply.
  release(JSON.stringify({ status: "pending" }));
  expect(await outcome).toBe(reason);
  expect(calls).toBe(2);
});

test("pending fixture marker times out at its ten-second deadline", async () => {
  let now = 1000;
  const clock = spyOn(Date, "now").mockImplementation(() => now);
  let polls = 0;
  try {
    const outcome = await seedDevThemes((expression) => {
      if (expression === seedDevThemesExpression) return Promise.resolve(true);
      polls++;
      now += 5000;
      return Promise.resolve(JSON.stringify({ status: "pending" }));
    }, new AbortController().signal).catch((error: unknown) => error);
    expect(outcome).toBeInstanceOf(Error);
    expect(String(outcome)).toContain(
      "Development theme fixtures timed out awaiting extension storage; restart the owned launcher.",
    );
    expect(polls).toBe(2);
    expect(now).toBe(11000);
  } finally {
    clock.mockRestore();
  }
});

test("launcher help documents default fixtures and opt-out", async () => {
  const child = Bun.spawn(
    [process.execPath, "tooling/dev-browsers.ts", "--help"],
    { stdout: "pipe", stderr: "pipe" },
  );
  expect(await new Response(child.stdout).text()).toContain("--no-fixtures");
  expect(await child.exited).toBe(0);
});
