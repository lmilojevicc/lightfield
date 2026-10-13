# CI/CD operations

## Bootstrap and settings

`lmilojevicc/lightfield` exists but has no source yet. **No source push or public release until the maintainer completes licence review**, including third-party artwork/source redistribution rights, Commons Clause restrictions and packaged licence completeness. Automation does not establish permission to distribute. README badges are pending until the first approved push; the version badge reads `package.json` on `main`, not the latest release.

The maintainer has configured read-only default workflow tokens, disabled Actions approval of pull requests, and created the `release` environment restricted to `main` with zero required reviewers. The remote remains empty. These settings do not clear the publication hold.

After clearance, the maintainer owns the initial push and remaining GitHub settings. Workflow files alone do not enforce repository policy:

- Use Actions on GitHub-hosted runners and retain read-only default token permissions. Do not enable write tokens or secrets for fork PR workflows. Approve first-time contributor runs only after reviewing their changes.
- After the first CI run registers **Validate**, require PRs and that check on `main`, with **zero required approvals** for a solo maintainer. Disallow force pushes and deletion, and enforce rules for administrators where supported. Do not require a second person or self-approval to unblock routine work. Until bootstrap and check registration, these protections are not fully enforceable.
- Keep the **release** environment restricted to `main`, with zero required reviewers for solo maintenance. Restrict repository write/Actions dispatch access to the maintainer: environments do not independently provide a maintainer-only dispatch ACL. There is no approval pause after dispatch; successful validation proceeds to draft creation. Manual dispatch and later draft publication are the maintainer's decision points. No environment secrets are needed.
- Enable dependency alerts and review Dependabot PRs manually. Keep release tags protected from modification/deletion where supported. Check plan/settings support rather than assuming YAML configures protections.

## Validation boundary

`ci.yml` runs on PRs targeting `main`, pushes to `main`, and manual dispatch. Its stable required job name is **Validate**. Ubuntu 24.04, Node 24 and the exact Bun version in `package.json` run:

```sh
bun install --frozen-lockfile
bun run validate
bun audit --audit-level=high
```

`zip` and `unzip` must be available (included on the hosted runner). Baseline tests do not provision real browsers; see [Contributing](../CONTRIBUTING.md). Failures block the job, including high/critical audit findings. Fix or update dependencies rather than ignoring the audit exit status.

PR jobs receive only `contents: read`, no secrets, no persisted checkout credentials and no dependency/runtime caches. Actions are SHA-pinned with version comments. Superseded CI runs are cancelled; each job has a timeout. Successful runs retain `unsigned-local-use-chromium` and `unsigned-local-use-firefox` artifacts for three days. These are testing ZIPs, not signed releases, and PR artifacts are never release inputs.

Dependabot checks Bun and Actions weekly, groups minor/patch updates, and limits each ecosystem to three open PRs. Major updates stay separate. No automerge or cooldown is configured. Review the exact Bun runtime pins separately; do not assume dependency updates upgrade the runtime.

### Current audit blockers — 2026-10-13

With Bun 1.4.2, `bun run validate` passes (Firefox lint has two existing warnings), but `bun audit --audit-level=high` fails. **CI and draft releases are intentionally blocked.** The maintainer's dry run found no safe in-range remediation:

- **High:** `basic-ftp@5.3.1` via `proxy-agent`: [GHSA-c475-qrg2-pj4r](https://github.com/advisories/GHSA-c475-qrg2-pj4r). Fix requires 6.2.1, but `get-uri@8.0.1` requires `^5.3.1`.
- **High:** `node-forge@1.4.0` via `web-ext`: [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv). No published fixed version at this check.
- **Critical:** `shell-quote@1.10.0` via `web-ext` / `fx-runner`: [GHSA-pqg4-j6r4-53mv](https://github.com/advisories/GHSA-pqg4-j6r4-53mv). Fix requires 1.11.0, but `fx-runner@1.6.0` pins 1.10.0.

Dependency remediation needs a separate maintainer-reviewed change. Do not ignore advisories or bypass the audit gate; recheck upstream fixes before updating this dated status.

## Draft release

No release run is needed to bootstrap CI. Do not dispatch while redistribution blockers remain unresolved.

1. Through a PR, bump strict `X.Y.Z` in **both** `package.json` and `tooling/manifest.ts`; no `v` prefix, leading zeros, prerelease or build suffix. Merge with Validate passing. The release gate checks both built manifests against the package version.
2. Open **Draft release → Run workflow**, selecting **main** only. The workflow rejects any other ref. It rebuilds the exact dispatch SHA (not whatever `main` points to later), runs the full validation and audit again, then hashes exactly `lightfield-chromium.zip` and `lightfield-firefox.zip` into `SHA256SUMS`. There are no caches.
3. Monitor validation. With zero environment reviewers, the isolated publish job proceeds automatically after validation and the `release` environment's main-branch restriction pass. It receives only the successful same-run bundle and a strictly validated version output. It has `contents: write` but performs no checkout, install or repository-script execution. Its ephemeral token is scoped to the `gh` step.
4. The workflow verifies checksums and creates a **draft** `vVERSION` targeting the dispatch SHA, with exactly the two ZIPs and `SHA256SUMS` as uploaded assets. Existing tags are refused to avoid targeting a different commit (`gh --target` cannot override an existing tag); tag lookup errors fail the job. Existing releases are never overwritten. Releases are serialized without cancelling an active run. GitHub concurrency keeps at most one pending run, so avoid queueing multiple dispatches.
5. Inspect the draft's target commit, assets, checksums, notices and warning notes. Resolve stable Gecko identity, Firefox signing/data declarations and all licence/distribution blockers before deciding whether publication is appropriate. Publication is a separate maintainer decision; there is no automatic publication, browser-store credential or store submission.

The default notes prominently identify unsigned/local-use ZIPs and the existing Gecko/licence blockers. Do not remove warnings merely because CI is green. GitHub-generated source downloads are not extension ZIPs, are not covered by `SHA256SUMS`, and need their own redistribution review. Checksums detect changed bytes; they are not signatures, attestations or proof of reproducible ZIPs. ZIP timestamps/order are not normalized.

## Failure and recovery

A validation, audit, version or artifact failure prevents the draft job. Fix the cause through a PR; do not skip the gate. If draft creation partially succeeds or a version/tag already exists, inspect it manually before retrying; the workflow will not overwrite it. Do not move an existing version tag to new code.

For a published defect, withdraw inappropriate assets if necessary and ship a **higher-version forward fix** through the same review process. Reverting code still needs a new version in both version sources. Browser extension downgrades are not a reliable rollback mechanism; store-side actions remain manual.

## Security limits

No dangerous PR triggers, cross-workflow artifact promotion, self-hosted runners, release caches or long-lived publication credentials are used. Protect `main`, workflow edits and the release environment: trusted main code still controls the build. Review action upgrades and dependency runtime behavior; SHA pins do not pin every binary an action downloads. Repository/org policy, access control, 2FA, actual hosted-run behavior and legal clearance require separate maintainer checks. No provenance attestation or signing is claimed.
