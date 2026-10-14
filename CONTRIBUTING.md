# Contributing

Source publication is on hold pending licence review. The public repository is currently empty; the fork/PR flow and badges become available after the maintainer's approved bootstrap push. Do not redistribute source or binaries until that review is complete.

## Development

Use Node 24+, Bun **1.4.2** (pinned in `package.json`), and `zip` / `unzip` on PATH.

```sh
bun install --frozen-lockfile
bun run validate
bun run audit
```

Once bootstrapped, fork `lmilojevicc/lightfield`, branch from `main`, and open a PR back to `main`. Maintainer changes use PRs too. Keep changes focused and describe validation performed. Do not commit `dist/`, `artifacts/`, browser profiles or secrets.

The required **Validate** check runs types, lint, formatting, dead-code checks, tests, both builds, package inspection, packaging, Firefox lint and a high/critical dependency audit. Run the same gates locally; do not bypass failures. Format only files you change, for example `bun --bun prettier --write CONTRIBUTING.md`.

## Browsers (opt-in)

`bun run dev` provisions pinned Chromium and Firefox in a user cache and uses disposable profiles. Baseline validation does not run real-browser smoke tests. Optional extension smoke tests:

```sh
LIGHTFIELD_DEV_SMOKE=1 bun test tooling/dev-browsers.test.ts
```

Run these in an isolated checkout: they rebuild and temporarily edit a source file. Browser downloads and OS libraries are separate prerequisites. UI tests opt in via `LIGHTFIELD_UI_HEADLESS_CHROME`; renderer startup tests additionally need a parent-owned headless CDP process and production server, not just an environment flag.

## Dependencies and licences

Dependabot proposes weekly Bun (`bun.lock`) and GitHub Actions updates, grouping minor/patch changes with small PR limits. There is no automerge. Review upstream changes, action SHA/version comments and audit results before merging. Update Bun's exact `packageManager` and `engines.bun` pins together when deliberately upgrading the runtime; use frozen installs to check the lockfile.

Do not reformat byte-pinned legal notices or change provenance hashes to make a build pass. The project's MIT licence does not override third-party terms, including Commons Clause restrictions. New assets and dependencies need licence review.

See [CI/CD operations](docs/ci-cd.md) for repository setup and draft releases.
