---
name: deploy-lervo-release
description: Deploy a published Lervo CLI release across the fleet. Use when the owner asks to release, deploy, roll out, upgrade, or migrate Lervo, or after a `v<version>` tag and its CLI release matrix succeed. Covers the Hub, every host's global lervo CLI, knowledge host services, delegations, and `lervo upgrade` on every registered repository.
---

# Deploy a Lervo release to the whole fleet

Unless the owner names an exception, update every item below on every host. Deployment is never partial; do not ask which parts to include.

## Before a release pull request

Verify every feature pull request before opening it; CI confirms local verification:

1. Finish review fixes, then run the full suite once: `pnpm test` with `TMPDIR` set to a real path (`python3 -c "import os,tempfile;print(os.path.realpath(tempfile.gettempdir()))"`). Report, rather than ignore, failures that also occur on unmodified `main` on the same host.
2. Run `pnpm quality:check`, `pnpm typecheck`, `pnpm architecture:check`, and `pnpm release:completion:check --base <task-base>`. CI runs the same typecheck against the supported Node minimum; focused tests do not establish that it passes.
3. Run `pnpm build` immediately before `pnpm release:manifest:update` and `pnpm release:sbom:update`; commit metadata separately. A manifest from an older build fails CI. A pull request carrying release intent may skip this step: its preparation commit regenerates metadata from a macOS build.
4. Run `pnpm release:attestation:check` and all seven distribution smokes: `smoke:built-cli`, `smoke:built-hub`, `smoke:hub-distribution`, `smoke:built-node`, `smoke:node-distribution`, `smoke:packed-cli`, and `smoke:registry-publish`.
5. Get an adversarial review; re-judge each finding before fixing it.

## Wait for release stages

`scripts/wait-release.sh` always exits: 0 for success, 1 for failure, 2 for timeout, and 3 when the pull request head lacks current `main`. Run each stage in the background and act on its exit.

1. For a feature pull request carrying release intent, prepare the release as soon as it opens: `gh pr edit <number> --add-label release` or `gh workflow run release-pull-request.yml -f pull_request=<number>`. If needed, create the label once with `gh label create release`. Preparation adds one `chore(cli): prepare release` commit atop current `main` and dispatches full CI for that exact commit. Keep the intent and preparation commits separate; never squash them.
2. Run `scripts/wait-release.sh pr <number>`. It waits for preparation, then judges the current head. For a prepared head, the newest dispatched Code quality run for that exact SHA decides: dispatched runs are not pull request checks, and the run also posts the `CI verification (lervo-ci-v1)` commit status. Other heads use pull request checks. On exit 3, run `gh pr update-branch <number>` for a pull request without intent; for a prepared pull request, rerun `gh workflow run release-pull-request.yml -f pull_request=<number>`. Then wait again. Freshness and verification judge the same observed head; if it moves during checks, it is judged again. Merge using `gh pr merge <number> --merge --match-head-commit <sha>` with the SHA printed by the script, so main's tree equals the verified head and main reuses its CI.
3. Run `scripts/wait-release.sh tag <version>` to wait for the `v<version>` tag, its CLI release matrix on any event, and the published GitHub Release. Preparation tags directly after main CI because no intent remains on `main`.

Use `scripts/wait-release.sh release-pr` only as a fallback when intent reached `main` unprepared. Preparation then opens `lervo/release-cli` and dispatches candidate CI for that exact commit. Merge that release pull request on success. Pull-request-triggered runs on that branch showing `action_required` without jobs are expected.

Never write ad hoc polling loops for these stages: earlier loops missed completed stages by filtering the wrong event.

## Preconditions

1. The release tag `v<version>` exists; its CLI release matrix and GitHub Release succeeded.
2. No open Lervo pull request is intended for this release.
3. Resolve hosts from `.lervo/environment-targets/` using `lervo environment query --target <target-id> --json`. The always-on host runs the Hub. Include every host with a registered repository.

## Build artifacts once from the tag commit

1. Create a clean worktree at the tag commit; install, build, and run `pnpm release:manifest:check` and `pnpm release:sbom:check`.
2. Pack the CLI with `packCliArtifact(<release-dir>, <version>)` from `scripts/distribution/lib/packed-cli-artifact.mjs`. Keep the tarball, `apps/cli/release-artifact-manifest.json`, and `apps/cli/release-sbom.cdx.json` together in a release directory named for the version and short commit.
3. Build the Hub for each Hub host platform: `pnpm hub:distribution:build -- --output <release-dir>/lervo-hub-<version>-<platform>.tar.gz --platform <platform> --write`. Record the printed SHA-256.
4. Copy the release directory to every other host; compare SHA-256 values before use.

## Order across hosts

Update readers before writers: `lervo upgrade` activates new event schema versions only after every configured reader supports them.

1. **Hub**
   - On the Hub host, run `python3 -I scripts/hub-backup.py <version>-<date>`. It makes an online SQLite backup and fails unless the integrity check is `ok`.
   - Install with `scripts/distribution/install-hub-runtime-distribution.mjs --archive --artifact --expected-sha256 --target <new-directory> --write`. Its scripts need only `packages/runtime-security/dist` from the tag build.
   - Render the service with `scripts/distribution/render-runtime-service.mjs`, runtime `hub`, using the same Node and config. Copy the current unit as the previous definition.
   - Switch with `scripts/distribution/manage-runtime-service.mjs --action upgrade ... --write`.
   - Verify `/v1/health/live`, `/v1/health/ready`, and that `/v1/health/capabilities` lists the new readable event schema versions. On failure, upgrade back to the previous definition.
2. **Global CLI on every host**
   - Install the tarball side by side in a new versioned directory. Use the previous install's `package.json` dependency set, with `@lervo/cli` pointing to the new tarball. The `file:` path must be absolute; check with `grep -o 'file:[^"]*' package.json` before installing, because shell-expanded home directories have previously been doubled.
   - Atomically relink `lervo` and `lervo-node` to the new `dist/bin.js` and `dist/node-runtime.js`.
   - Record previous and new targets in `<host>-global-cli-activation.json` in the release directory.
3. **Registered repositories on every host**
   - Read each host's registry, `repositories.json` in its Lervo state directory; do not use a remembered list.
   - Run `scripts/upgrade-all.sh <release-dir>/<host>-upgrade-receipts` on each host. It implements the following upgrade steps.
   - For each repository, run `lervo upgrade --json`, apply `--apply --approval <planId>`, and repeat until status is `current`.
   - If a background cycle changes the plan during the wait (`upgrade_plan_changed`), use `lervo upgrade --apply --safe`.
   - Keep receipts under `<release-dir>/<host>-upgrade-receipts/`.
   - Never commit generated outputs to an owner's working branch. Report repositories with uncommitted generated changes.
4. **Services and policy**
   - Confirm each host's knowledge host service runs the new CLI and is not burning CPU.
   - Keep delegation provider order identical across hosts.

## Report

Report the final status of every host and repository. Name stages blocked by repository content, such as lint errors, and identify the actor responsible for resolving each. A content-blocked stage does not justify skipping other repositories or hosts.
