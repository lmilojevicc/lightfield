# CI/CD operations

## Bootstrap and settings

`lmilojevicc/lightfield` is public with source published by maintainer approval. **Public releases remain on hold pending licence review**, including third-party artwork/source redistribution rights, Commons Clause restrictions and packaged licence completeness. Automation does not establish permission to distribute. The version badge reads `package.json` on `main`, not the latest release.

The maintainer has configured read-only default workflow tokens, disabled Actions approval of pull requests, and created the `release` environment restricted to `main` with zero required reviewers. Source publication does not clear the release hold.

The maintainer owns GitHub settings. Workflow files alone do not enforce repository policy:

- Use Actions on GitHub-hosted runners and retain read-only default token permissions. Do not enable write tokens or secrets for fork PR workflows. Approve first-time contributor runs only after reviewing their changes.
- `main` requires PRs, an up-to-date branch and **Validate**, with **zero required approvals** for a solo maintainer. Force pushes and deletion are disabled, and the rules include administrators. Retain these protections; do not require a second person or self-approval to unblock routine work.
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

### Current audit blocker — 2026-10-14

With Bun 1.4.2, `bun run validate` passes (Firefox lint has two existing warnings), but the full `bun audit --audit-level=high` fails with one finding. **CI and draft releases are intentionally blocked.**

- **High:** `node-forge@1.4.0` via `web-ext@10.7.0` → `@devicefarmer/adbkit@3.3.9`: [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv). No published fixed version at this check. Wait for a reviewed published fix; no audit exception, fork or tooling replacement is authorized.

Exact root overrides resolve the other two advisories:

- `basic-ftp@6.2.3`: `proxy-agent` → `pac-proxy-agent` → `get-uri@8.0.1` still requires `^5.3.1`, excluding patched releases. Local FTP checks cover MDTM, LIST fallback, cache, download completion/errors and same-host EPSV/PASV. Alternate PASV hosts remain denied by default. Existing get-uri limitations remain: Unix/DOS LIST raw timestamps lack `modifiedAt`, and its download promise has no rejection handler.
- `shell-quote@1.12.0`: `web-ext@10.7.0` → `fx-runner@1.6.0` pins vulnerable `1.10.0`. Regression tests cover quoted arguments/profile paths and rejection of comment line terminators without executing input.

Remove each override when the parent chain permits patched versions normally, after checking all resolved copies and rerunning compatibility tests, frozen installation, full validation and audit. Do not ignore advisories or bypass the audit gate; recheck upstream fixes before updating this dated status.

TypeScript 6.0.3 is paired with `svelte-check@4.7.6` (supports TS 5/6) and `typescript-eslint@8.71.2` (supports `<6.1.0`). All seven configured projects remain checked. Dependabot ignores only TypeScript `>=7`: TS 7 lacks the legacy compiler API required by the current Svelte checker. Revisit that limit when both integrations support it; supported TS 6 and other ecosystem updates remain enabled.

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
