import { resolve } from "node:path";
import { root } from "./paths";

/**
 * Dependency audit with explicitly reviewed, expiring exceptions.
 *
 * `bun audit` cannot express reachability: it flags every installed advisory,
 * including code paths this project never runs. Exceptions are therefore kept
 * in a small reviewed file, fail closed on malformed or expired entries, and
 * pass only the named advisories to `bun audit`.
 */
interface AuditException {
  ghsa: string;
  package: string;
  expires: string;
  reason: string;
  removal: string;
}

const ghsaPattern = /^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNote(ghsa: string, field: string, value: unknown): string {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`Exception ${ghsa} needs a ${field} note`);
  return value;
}

function readException(value: unknown, index: number): AuditException {
  if (!isRecord(value))
    throw new Error(`Exception ${String(index)} must be an object`);
  const { ghsa, package: name, expires, reason, removal } = value;
  if (typeof ghsa !== "string" || !ghsaPattern.test(ghsa))
    throw new Error(`Exception ${String(index)} needs a GHSA id`);
  if (typeof name !== "string" || name.trim() === "")
    throw new Error(`Exception ${ghsa} needs a package name`);
  if (typeof expires !== "string" || !datePattern.test(expires))
    throw new Error(`Exception ${ghsa} needs a YYYY-MM-DD expiry`);
  return {
    ghsa,
    package: name,
    expires,
    reason: requireNote(ghsa, "reason", reason),
    removal: requireNote(ghsa, "removal", removal),
  };
}

/** Expired exceptions fail closed, so an accepted advisory cannot rot silently. */
export function auditIgnores(
  document: unknown,
  now = new Date(),
): AuditException[] {
  if (document === undefined) return [];
  if (!isRecord(document))
    throw new Error("Audit exceptions must be a JSON object");
  const entries = document.exceptions ?? [];
  if (!Array.isArray(entries))
    throw new Error("Audit exceptions must list an exceptions array");
  const exceptions = entries.map(readException);
  for (const exception of exceptions)
    if (now.getTime() > Date.parse(`${exception.expires}T23:59:59Z`))
      throw new Error(
        `Audit exception ${exception.ghsa} (${exception.package}) expired on ${exception.expires}: ${exception.removal}`,
      );
  return exceptions;
}

export function auditArguments(
  exceptions: readonly AuditException[],
): string[] {
  const seen = new Set<string>();
  const args = ["audit", "--audit-level=high"];
  for (const exception of exceptions) {
    if (seen.has(exception.ghsa)) continue;
    seen.add(exception.ghsa);
    args.push(`--ignore=${exception.ghsa}`);
  }
  return args;
}

if (import.meta.main) {
  const exceptions = auditIgnores(
    await Bun.file(resolve(root, ".github/audit-exceptions.json"))
      .json()
      .catch(() => undefined),
  );
  for (const exception of exceptions)
    console.log(
      `lightfield: audit exception ${exception.ghsa} (${exception.package}) until ${exception.expires}: ${exception.reason}`,
    );
  const child = Bun.spawn([process.execPath, ...auditArguments(exceptions)], {
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(await child.exited);
}
