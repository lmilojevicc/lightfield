import { describe, expect, test } from "bun:test";
import { releaseVersion } from "./release-version";

describe("release version gate", () => {
  test.each(["0.1.0", "1.2.3", "10.20.300"])(
    "accepts matching %s",
    (version) => {
      const metadata = { version };
      expect(releaseVersion(metadata, metadata, metadata)).toBe(version);
    },
  );

  test.each([
    "v1.2.3",
    "01.2.3",
    "1.02.3",
    "1.2.03",
    "1.2",
    "1.2.3.4",
    "1.2.3-beta.1",
    "1.2.3+build",
    " 1.2.3",
    "1.2.3\n",
    "1.2.3\r",
    "1.2.3\nversion=9.9.9",
    "$(touch injected)",
    "",
    123,
    null,
  ])("rejects invalid package version %j", (version) => {
    expect(() => releaseVersion({ version }, { version }, { version })).toThrow(
      "strict X.Y.Z",
    );
  });

  test.each(
    [undefined, null, {}, [], "1.2.3"].map((metadata) => ({ metadata })),
  )("rejects malformed metadata %j", ({ metadata }) => {
    expect(() => releaseVersion(metadata, metadata, metadata)).toThrow();
  });

  test("rejects either built manifest mismatch or missing version", () => {
    const valid = { version: "1.2.3" };
    for (const invalid of [{ version: "1.2.4" }, { version: 123 }, {}, null]) {
      expect(() => releaseVersion(valid, invalid, valid)).toThrow("chromium");
      expect(() => releaseVersion(valid, valid, invalid)).toThrow("firefox");
    }
  });
});
