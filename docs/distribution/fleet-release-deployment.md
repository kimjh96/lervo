# Deploy a Lervo release across the fleet

This runbook records the procedure in `.agents/skills/deploy-lervo-release/SKILL.md`. It does not establish that a release, deployment, smoke test, or publication occurred. Unless the owner specifies an exception, deployment includes the Hub, global CLI, registered repositories, and knowledge host services on every host.

## Verify and prepare the release

Before opening a feature pull request:

1. Finish review fixes, then run the full `pnpm test` suite once with `TMPDIR` set to a real path. Resolve that path with `python3 -c "import os,tempfile;print(os.path.realpath(tempfile.gettempdir()))"`. Report failures that also reproduce on unmodified `main` on the same host.
2. Run `pnpm quality:check`, `pnpm typecheck`, `pnpm architecture:check`, and `pnpm release:completion:check --base <task-base>`. Focused tests do not establish minimum-supported-Node typecheck success.
3. Do not regenerate or commit the CLI release manifest or SBOM. CI generates them for an ordinary pull request, and release preparation commits them. A run checks the committed files exactly only for an unreleased CLI version or an edit to the files, and a new platform package family fails generation. On such a failure, commit the files from the run's `lervo-cli-release-metadata` artifact ([ADR-0572](../decisions/release/packaging/0572-commit-cli-release-metadata-only-when-a-release-is-prepared.md)).
4. Run `pnpm release:metadata:check` and all seven distribution smokes. The metadata check runs the manifest, SBOM, and release statement checks while the CLI version is unreleased and explains its skip otherwise. The smokes are `smoke:built-cli`, `smoke:built-hub`, `smoke:hub-distribution`, `smoke:built-node`, `smoke:node-distribution`, `smoke:packed-cli`, and `smoke:registry-publish`.
5. Obtain an adversarial review and assess each finding before applying fixes.

Follow [CLI version and release management](cli-version-management.md) for release intent and authority boundaries. Prepare a feature pull request carrying intent by adding the `release` label or dispatching `release-pull-request.yml` with `pull_request=<number>`. Create the label once if absent. Keep the intent and preparation commits separate; do not squash them.

## Wait for exact release evidence

Use `scripts/wait-release.sh` in the background and inspect its exit status: 0 means success, 1 failure, 2 timeout, and 3 a stale pull request head. Do not replace it with an ad hoc polling loop.

- `scripts/wait-release.sh pr <number>` waits for preparation and judges the observed head. A prepared head requires its newest exact-SHA dispatched Code quality run and CLI release matrix run; the Code quality run posts `CI verification (lervo-ci-v1)` as a commit status. A prepared head with no matrix dispatch keeps waiting until preparation is rerun. Other heads use pull request checks. Moving heads are judged again.
- On exit 3, update a pull request without intent using `gh pr update-branch <number>`, or rerun preparation for a prepared pull request, then wait again.
- Merge using `gh pr merge <number> --merge --match-head-commit <sha>`, binding the merge to the head printed by the script.
- `scripts/wait-release.sh tag <version>` waits for the tag, its CLI release matrix on any event, and the published GitHub Release with the tarball, manifest, SBOM, and `release-subjects.json` attached. If the tag's matrix run fails, re-run all of its jobs (`gh run rerun <run-id>`), not only the failed ones, so its reuse plan is decided again.

Use `scripts/wait-release.sh release-pr` only when intent reached `main` unprepared. The fallback creates `lervo/release-cli` and dispatches candidate verification. Merge it after success. Pull-request-triggered runs on that branch may show `action_required` without jobs; verification comes from the dispatch.

## Follow releases on every host

A host whose installed CLI provides `lervo host upgrade --follow` ([ADR-0575](../decisions/distribution/0575-follow-published-releases-on-every-host.md)) needs no deploy step for its CLI and registered repositories. Enable it once on every host from the owner's normal shell. `lervo host upgrade --follow --service install --json` shows the plan, and the same command with `--apply` installs and starts the `host-follow` user service. It follows the repository the host last installed from through `lervo host upgrade --from-release`; on a host without such an install the plan reports `host_follow_repository_unknown`, and both commands need `--repository <owner/name>` once. The service keeps that shell's `PATH`, and its first cycle upgrades every registered repository.

Each follower polls GitHub Releases every 5 minutes with ±20% jitter. It installs only the newest published release through the verified `--from-release` path, upgrades every registered repository, and restarts itself on the new CLI. A failed health gate or Node readiness rolls that host back by activation id and marks the tag failed there. `--follow --pause`, `--follow --pin v<version>`, and `--follow --resume` hold or release one host. `--follow --status` reports the last check, outcome, failed tags, repository pass, and service definition; the [host release follower contract](host-release-follower.md) defines them. When it reports `definition_outdated`, rerun `--service install --apply` while no pass is in flight ([ADR-0577](../decisions/distribution/0577-keep-the-upgrade-exclusion-through-event-loop-stalls.md)). The steps below remain the fallback for hosts without the follower, paused hosts, and the Hub.

## Establish deployment scope

Require the `v<version>` tag, successful tag-bound CLI release matrix, and GitHub Release with its four verified assets. Confirm that no open Lervo pull request is intended for this release.

Resolve hosts from `.lervo/environment-targets/` and refresh each with `lervo environment query --target <target-id> --json`. The always-on host runs the Hub. Include every host with a registered repository.

## Build and transfer exact artifacts

1. Create a clean worktree at the tag commit. Install dependencies, build, and run `pnpm release:manifest:check` and `pnpm release:sbom:check`.
2. Download the verified CLI files with `gh release download v<version> --dir <release-dir>`, using a directory named for the version and short commit. From the tag worktree, run `node scripts/release/commands/cli-release-subjects.mjs verify <release-dir> --expected-tag v<version>` and use the tarball only after it passes. These are the bytes the matrix verified, darwin native files included. Only for a release without these assets, use `packCliArtifact(<release-dir>, <version>)` from `scripts/distribution/lib/packed-cli-artifact.mjs` and keep the tarball, `apps/cli/release-artifact-manifest.json`, and `apps/cli/release-sbom.cdx.json` together.
3. Build each required Hub platform with `pnpm hub:distribution:build -- --output <release-dir>/lervo-hub-<version>-<platform>.tar.gz --platform <platform> --write`. Record the printed SHA-256.
4. Copy the release directory to the other hosts and compare SHA-256 values before use.

## Deploy readers before writers

### Hub

On the Hub host, run `python3 -I scripts/hub-backup.py <version>-<date>`. Its online SQLite backup must pass the integrity check with `ok`.

Install the archive through `scripts/distribution/install-hub-runtime-distribution.mjs`, supplying its archive, artifact, expected SHA-256, new target directory, and `--write`. The installer scripts require `packages/runtime-security/dist` from the tag build.

Retain the current service definition. Render the replacement with `scripts/distribution/render-runtime-service.mjs`, runtime `hub`, and the same Node executable and configuration. Switch using the service manager's `upgrade` action with `--write`.

Verify `/v1/health/live`, `/v1/health/ready`, and the newly readable event schema versions in `/v1/health/capabilities`. On failure, upgrade back to the retained service definition.

### Global CLI on every host

Use `lervo host upgrade` ([ADR-0571](../decisions/distribution/0571-install-the-verified-cli-on-each-host-and-roll-back-by-activation-id.md)) only when the installed CLI provides it and its plan, `lervo host upgrade --from-release v<version> --repository <owner/name> --json`, succeeds. Until the first ADR-0569 release passes that plan, use the manual steps below. Then run the same command with `--apply` on each host and keep its output in the release directory. It verifies the published assets against the tag, installs side by side, switches `lervo` and `lervo-node`, runs `lervo --version` and a `node --check` parse check of `lervo-node` (not a runtime health check), and records an activation id; `lervo host upgrade --rollback <activation-id> --apply` restores the replaced links. Resolve a PATH-shadowing warning from the plan before applying.

Install side by side in a new versioned directory. Preserve the previous installation's `package.json` dependency set and point `@lervo/cli` at the new tarball using an absolute `file:` path. Inspect that path before installation; the source records a prior doubled-home-directory expansion error.

Atomically relink `lervo` and `lervo-node` to the new `dist/bin.js` and `dist/node-runtime.js`. Record previous and new targets in `<host>-global-cli-activation.json` inside the release directory.

### Every registered repository

Read each host's current `repositories.json` from its Lervo state directory. Run `scripts/upgrade-all.sh <release-dir>/<host>-upgrade-receipts` on each host.

For each repository, obtain `lervo upgrade --json`, apply its exact plan with `--apply --approval <planId>`, and repeat until `current` or a concrete blocker requires resolution. If a background cycle causes `upgrade_plan_changed`, use `lervo upgrade --apply --safe`. Retain receipts under the host's release receipt directory.

Never commit generated outputs into the owner's working branch. Report repositories with uncommitted generated changes. A blocked content stage does not justify skipping other repositories or hosts.

### Services and policy

Confirm that each knowledge host service runs the new CLI without excessive CPU use. Keep delegation provider order identical across hosts. Reader compatibility must precede writer activation; service status alone does not prove runtime readiness.

## Report the observed result

Report every host and repository with its final status, retained receipts, remaining blockers, and the actor responsible for resolving each blocker. Distinguish completed operations from pending verification. Tag creation and GitHub Release availability do not establish npm publication authority or publication success.
