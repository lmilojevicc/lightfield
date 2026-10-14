import { expect, test } from "bun:test";
import { auditArguments, auditIgnores } from "./audit";

const exception = {
  ghsa: "GHSA-86w9-cpqp-85rv",
  package: "node-forge",
  expires: "2027-01-15",
  reason: "Dev-only Android tooling path that no workflow executes.",
  removal: "Delete once node-forge ships a fix above 1.4.0.",
};

test("accepts a reviewed, unexpired exception and ignores only its advisory", () => {
  const exceptions = auditIgnores(
    { exceptions: [exception] },
    new Date("2026-10-14T12:00:00Z"),
  );
  expect(exceptions).toEqual([exception]);
  expect(auditArguments(exceptions)).toEqual([
    "audit",
    "--audit-level=high",
    "--ignore=GHSA-86w9-cpqp-85rv",
  ]);
});

test("an exception is allowed through its expiry day and fails closed afterwards", () => {
  expect(() =>
    auditIgnores({ exceptions: [exception] }, new Date("2027-01-15T23:00:00Z")),
  ).not.toThrow();
  expect(() =>
    auditIgnores({ exceptions: [exception] }, new Date("2027-01-16T00:00:01Z")),
  ).toThrow("expired on 2027-01-15");
});

test("malformed exceptions fail closed instead of weakening the audit", () => {
  const now = new Date("2026-10-14T12:00:00Z");
  for (const document of [
    { exceptions: "GHSA-86w9-cpqp-85rv" },
    { exceptions: [null] },
    { exceptions: [{ ...exception, ghsa: "CVE-2026-0001" }] },
    { exceptions: [{ ...exception, package: "  " }] },
    { exceptions: [{ ...exception, expires: "2027-1-5" }] },
    { exceptions: [{ ...exception, reason: "" }] },
    { exceptions: [{ ...exception, removal: " " }] },
  ])
    expect(() => auditIgnores(document, now)).toThrow();
  expect(() => auditIgnores("exceptions", now)).toThrow();
  // A repository without the file simply audits everything.
  expect(auditIgnores(undefined, now)).toEqual([]);
});

test("duplicate advisories are passed to bun audit once", () => {
  const exceptions = auditIgnores(
    { exceptions: [exception, { ...exception, expires: "2026-12-01" }] },
    new Date("2026-10-14T12:00:00Z"),
  );
  expect(auditArguments(exceptions)).toEqual([
    "audit",
    "--audit-level=high",
    "--ignore=GHSA-86w9-cpqp-85rv",
  ]);
});
