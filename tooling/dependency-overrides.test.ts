import { expect, test } from "bun:test";
import { dirname, resolve } from "node:path";

// Resolve from the consumers: these overrides must protect their actual copies.
const webExtDirectory = dirname(Bun.resolveSync("web-ext", import.meta.dir));
const fxRunnerDirectory = dirname(
  Bun.resolveSync("fx-runner", webExtDirectory),
);
const shellQuote = (await import(
  Bun.resolveSync("shell-quote", fxRunnerDirectory)
)) as {
  parse(command: string): unknown[];
  quote(tokens: (string | { comment: string })[]): string;
};
const { buildArgs } = (await import(
  resolve(fxRunnerDirectory, "lib/run.js")
)) as {
  buildArgs: (options: Record<string, unknown>) => unknown[];
};

test("fx-runner preserves quoted arguments and profile paths with shell-quote override", () => {
  expect(
    buildArgs({
      profile: "/tmp/Firefox profile",
      "binary-args":
        "  --name \"two words\"\t'single quoted' escaped\\ space\n--flag",
    }),
  ).toEqual([
    "-profile",
    "/tmp/Firefox profile",
    "--name",
    "two words",
    "single quoted",
    "escaped space",
    "--flag",
  ]);
  expect(shellQuote.parse('--name "#literal" #comment')).toEqual([
    "--name",
    "#literal",
    { comment: "comment" },
  ]);
  expect(
    buildArgs({
      profile: "named profile",
      "binary-args": ["--path", "/tmp/a b"],
      "binary-args-first": true,
    }),
  ).toEqual(["--path", "/tmp/a b", "-P", "named profile"]);
});

test("shell-quote rejects comment line terminators without executing input", () => {
  for (const newline of ["\n", "\r", "\u2028", "\u2029"]) {
    expect(() =>
      shellQuote.quote([{ comment: `comment${newline}untrusted-command` }]),
    ).toThrow(TypeError);
    expect(() =>
      shellQuote.quote([{ comment: "comment" }, `${newline}untrusted-command`]),
    ).toThrow(TypeError);
  }
  expect(shellQuote.quote(["safe", { comment: "ordinary comment" }])).toBe(
    "safe #ordinary comment",
  );
});
