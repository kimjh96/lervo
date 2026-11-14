---
name: deploy-lervo-release
description: Deploy a published Lervo CLI release to the whole fleet in one pass. Use whenever the owner asks to release, deploy, roll out, upgrade, or migrate Lervo, or after a `v<version>` tag and its CLI release matrix succeed. Covers the Hub, the global lervo CLI on every host, knowledge host services, delegations, and `lervo upgrade` on every registered repository.
---

# Deploy a Lervo release to the whole fleet

A deployment is never partial. Unless the owner names an exception, one deployment updates every item below on every host. Do not ask which parts to include.

## Before a release pull request

Verify every feature pull request before opening it, so CI is a confirmation rather than the first test:

1. Finish review fixes first, then run the full suite once: `pnpm test` with `TMPDIR` set to a real path (`python3 -c "import os,tempfile;print(os.path.realpath(tempfile.gettempdir()))"`). A failure that also fails on unmodified `main` on the same host is reported, not ignored.
2. Run `pnpm quality:check`, `pnpm typecheck`, `pnpm architecture:check`, and `pnpm release:completion:check --base <task-base>`. CI runs the same typecheck against the supported Node minimum, so a passing focused test run does not prove it.
3. Run `pnpm build` immediately before `pnpm release:manifest:update` and `pnpm release:sbom:update`, and commit the metadata separately. A manifest made from an older build fails CI. A pull request with release intent can skip this step, because its preparation commit regenerates the metadata from a macOS build.
4. Run `pnpm release:attestation:check` and the seven distribution smokes (`smoke:built-cli`, `smoke:built-hub`, `smoke:hub-distribution`, `smoke:built-node`, `smoke:node-distribution`, `smoke:packed-cli`, `smoke:registry-publish`).
5. Get an adversarial review and re-judge each finding before fixing it.

## Wait for each release stage with the bundled script

`scripts/wait-release.sh` always exits: 0 on success, 1 on failure, 2 on timeout, and 3 when the pull request head does not contain current `main`. Run each stage in the background and act on its exit:

1. Prepare the release inside the feature pull request as soon as it is open, when it carries release intent: `gh pr edit <number> --add-label release`, or `gh workflow run release-pull-request.yml -f pull_request=<number>`. If the label does not exist yet, create it once with `gh label create release`. The workflow adds one `chore(cli): prepare release` commit on top of current `main` and dispatches full CI for that exact commit. Keep the intent commit separate from it; never squash them.
2. `scripts/wait-release.sh pr <number>`: waits for that preparation run, then judges the current head. For a prepared head, the newest dispatched Code quality run for that exact SHA decides, because dispatched runs are not pull request checks; the run also posts its result as the `CI verification (lervo-ci-v1)` commit status. Other heads use the pull request checks. On exit 3, run `gh pr update-branch <number>` for a pull request without intent, or rerun preparation for a prepared one with `gh workflow run release-pull-request.yml -f pull_request=<number>`, then wait again. Freshness and verification judge one observed head, and a head that moves during the checks is judged again. Merge with a merge commit bound to the head the script printed (`gh pr merge <number> --merge --match-head-commit <sha>`), so main's tree equals the verified head and main reuses its CI.
3. `scripts/wait-release.sh tag <version>`: the `v<version>` tag, its CLI release matrix on any event, and the published GitHub Release. Release preparation tags directly after main CI, because no intent remains on `main`.

Use `scripts/wait-release.sh release-pr` only on the fallback path, when intent reached `main` unprepared. Release preparation then opens `lervo/release-cli` and dispatches candidate CI for that exact commit. Merge that release pull request on success. The pull-request-triggered runs on that branch show `action_required` without jobs; that is expected.

Never write an ad hoc polling loop for these stages; earlier loops missed a finished stage by filtering the wrong event.

## Preconditions

1. The release tag `v<version>` exists, and the CLI release matrix and GitHub Release for that tag succeeded.
2. No open Lervo pull request is meant for this release.
3. Resolve hosts from `.lervo/environment-targets/` with `lervo environment query --target <target-id> --json`. The always-on host runs the Hub. Every host with a registered repository is in scope.

## Build the artifacts once, from the tag commit

1. Create a clean worktree at the tag commit, then install, build, and run `pnpm release:manifest:check` and `pnpm release:sbom:check`.
2. Pack the CLI with `packCliArtifact(<release-dir>, <version>)` from `scripts/distribution/lib/packed-cli-artifact.mjs`. Keep the tarball, `apps/cli/release-artifact-manifest.json`, and `apps/cli/release-sbom.cdx.json` together in a release directory named for the version and short commit.
3. Build the Hub for each Hub host platform: `pnpm hub:distribution:build -- --output <release-dir>/lervo-hub-<version>-<platform>.tar.gz --platform <platform> --write`. Record the printed SHA-256.
4. Copy the release directory to every other host and compare SHA-256 values before use.

## Order across hosts

Readers update before writers, because `lervo upgrade` activates new event schema versions only after every configured reader supports them.

1. **Hub.**
   - Back up the Hub database with `python3 -I scripts/hub-backup.py <version>-<date>` on the Hub host. It makes an online SQLite backup and fails unless the integrity check is `ok`.
   - Install with `scripts/distribution/install-hub-runtime-distribution.mjs --archive --artifact --expected-sha256 --target <new-directory> --write`. Its scripts need only `packages/runtime-security/dist` from the tag build.
   - Render the service with `scripts/distribution/render-runtime-service.mjs` (runtime `hub`, same Node and config). Copy the current unit as the previous definition.
   - Switch with `scripts/distribution/manage-runtime-service.mjs --action upgrade ... --write`.
   - Verify `/v1/health/live`, `/v1/health/ready`, and that `/v1/health/capabilities` lists the new readable event schema versions. On failure, upgrade back to the previous definition.
2. **Global CLI on every host.**
   - Install the tarball side by side in a new versioned directory, using the previous install's `package.json` dependency set with `@lervo/cli` pointing at the new tarball. The `file:` path must be the tarball's absolute path; check it with `grep -o 'file:[^"]*' package.json` before installing, because a shell-expanded home directory has been doubled before.
   - Atomically relink `lervo` and `lervo-node` to the new `dist/bin.js` and `dist/node-runtime.js`.
   - Record the previous and new targets in `<host>-global-cli-activation.json` in the release directory.
3. **Registered repositories on every host.**
   - Read each host's registry (`repositories.json` in the Lervo state directory), not a remembered list.
   - Run `scripts/upgrade-all.sh <release-dir>/<host>-upgrade-receipts` on each host; it implements the steps below.
   - For each repository, run `lervo upgrade --json`. Apply `--apply --approval <planId>`, and repeat until the status is `current`.
   - When a background cycle changes the plan during the wait (`upgrade_plan_changed`), use `lervo upgrade --apply --safe`.
   - Keep receipts under `<release-dir>/<host>-upgrade-receipts/`.
   - Never commit generated outputs into an owner's working branch. Report which repositories have uncommitted generated changes.
4. **Services and policy.**
   - Confirm the knowledge host service on each host runs the new CLI and is not burning CPU.
   - Keep delegation provider order identical across hosts.

## Report

Report each host and repository with its final status. Name any stage still blocked by repository content, such as a lint error, and say which actor resolves it. A blocked content stage is not a reason to skip the other repositories or hosts.
