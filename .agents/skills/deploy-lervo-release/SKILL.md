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
3. Do not regenerate or commit `apps/cli/release-artifact-manifest.json` or `apps/cli/release-sbom.cdx.json`. CI generates them for an ordinary pull request and lists the changes in the run summary; release preparation commits them. A run checks the committed files exactly only for an unreleased CLI version or an edit to the files, and a new platform package family also fails generation ([ADR-0572](../../../docs/decisions/release/packaging/0572-commit-cli-release-metadata-only-when-a-release-is-prepared.md)). If a run reports `release_artifact_mismatch`, `release_sbom_mismatch`, or `release_artifact_platform_dependency_unexpected`, commit the files from that run's `lervo-cli-release-metadata` artifact.
4. Run `pnpm release:metadata:check`, which checks the manifest, SBOM, and release statement while the CLI version is unreleased and explains its skip otherwise, and the seven distribution smokes (`smoke:built-cli`, `smoke:built-hub`, `smoke:hub-distribution`, `smoke:built-node`, `smoke:node-distribution`, `smoke:packed-cli`, `smoke:registry-publish`).
5. Get an adversarial review and re-judge each finding before fixing it.

## Wait for each release stage with the bundled script

`scripts/wait-release.sh` always exits: 0 on success, 1 on failure, 2 on timeout, and 3 when the pull request head does not contain current `main`. A failed `gh` or `git` query never counts as an empty answer: repeated failures print `gh_unavailable: <reason>` or `git_unavailable: <reason>` to stderr, the wait backs off, and a timeout ends with the last failure. Run each stage in the background and act on its exit:

1. Prepare the release inside the feature pull request as soon as it is open, when it carries release intent: `gh pr edit <number> --add-label release`, or `gh workflow run release-pull-request.yml -f pull_request=<number>`. If the label does not exist yet, create it once with `gh label create release`. The workflow adds one `chore(cli): prepare release` commit on top of current `main` and dispatches full CI for that exact commit; Code quality starts the CLI release matrix for it only after it passes (ADR-0593), so a failed preparation never pays for the macOS and Windows builds. Keep the intent commit separate from it; never squash them.
2. `scripts/wait-release.sh pr <number>`: waits for that preparation run, then judges the current head. For a prepared head, the newest dispatched Code quality run and the newest dispatched CLI release matrix run for that exact SHA decide together, because dispatched runs are not pull request checks; the Code quality run also posts its result as the `CI verification (lervo-ci-v1)` commit status. The matrix starts only after that Code quality run passes, so a prepared head waits for both in turn. A prepared head whose Code quality passed but which has no matrix run keeps waiting: rerun its preparation, which then dispatches the matrix without a new commit. Other heads use the pull request checks, and once they pass they wait until `main`'s CLI version has its `v<version>` tag, because `main` checks release metadata exactly until then. If that tag never comes because the release was abandoned, rerun release preparation (`gh workflow run release-preparation.yml`) or decide to merge from the GitHub interface. On exit 3, run `gh pr update-branch <number>` for a pull request without intent, or rerun preparation for a prepared one with `gh workflow run release-pull-request.yml -f pull_request=<number>`, then wait again. Freshness and verification judge one observed head, and a head that moves during the checks is judged again. Merge with a merge commit bound to the head the script printed (`gh pr merge <number> --merge --match-head-commit <sha>`), so main's tree equals the verified head and main reuses its CI. Never merge a pull request from the GitHub interface instead: a head verified on an older base can turn `main` red after a release merge, because `main` then checks the release metadata exactly.
3. `scripts/wait-release.sh tag <version>`: the `v<version>` tag, its CLI release matrix on any event, and the published GitHub Release with its four verified assets. Release preparation tags directly after main CI, because no intent remains on `main`. The tag run publishes the files that the pre-merge matrix verified for the same tree, so it normally takes about two minutes; it builds on all three platforms again only when no such run exists. If that tag run fails, re-run all of its jobs (`gh run rerun <run-id>`), never only the failed ones: a rerun of `GitHub release` alone keeps the old reuse decision, which fails again once the pre-merge artifact has expired.

Use `scripts/wait-release.sh release-pr` only on the fallback path, when intent reached `main` unprepared. Release preparation then opens `lervo/release-cli` and dispatches candidate CI for that exact commit. Merge that release pull request on success. The pull-request-triggered runs on that branch show `action_required` without jobs; that is expected.

Never write an ad hoc polling loop for these stages; earlier loops missed a finished stage by filtering the wrong event.

## Let every host follow releases

Once a host's installed CLI has `lervo host upgrade --follow` ([ADR-0575](../../../docs/decisions/distribution/0575-follow-published-releases-on-every-host.md)), that host needs no deploy step for its CLI and repositories. Enable the follower once on every host, Mac and WSL alike:

1. `lervo host upgrade --follow --service install --json` shows the plan; fix any blocker it names. Run it from the owner's normal shell: the service keeps that shell's `PATH` for `gh`, `pnpm`, `git`, and providers. The follower follows the repository this host last installed from with `lervo host upgrade --from-release`, which the activation journal records. If the plan reports `host_follow_repository_unknown`, the host never installed that way: add `--repository kimjh96/lervo` to this step and the next one.
2. `lervo host upgrade --follow --service install --apply` installs and starts the `host-follow` user service (`lervo-host-follow.service` or `com.lervo.host.follow`). Its first cycle runs `lervo upgrade` on every registered repository.
3. `lervo host upgrade --follow --status` shows the last check, the last outcome, failed tags, the last repository pass, and whether the service definition is current.
4. When `--status` reports `definition_outdated`, the installed service differs from what the active CLI renders, as after [ADR-0577](../../../docs/decisions/distribution/0577-keep-the-upgrade-exclusion-through-event-loop-stalls.md). Rerun step 2 only when `--status` shows no `in flight` line and `pgrep -fl 'upgrade --root'` finds no repository pass running, because replacing the service stops the follower and its running `lervo upgrade`. The follower never replaces its own service. `node_changed` needs no reinstall: only the checking shell's Node differs from the service's.

Within about 6 minutes of publication, each follower installs the newest published release through the verified `--from-release` path. It then upgrades every registered repository, and restarts itself on the new CLI. A failed health gate or Node readiness rolls that host back by activation id and marks the tag failed there. Hold one host with `--follow --pause` or `--follow --pin v<version>`, and release it with `--follow --resume`. To retry a failed tag, run `lervo host upgrade --from-release <tag> --repository kimjh96/lervo --apply` on that host.

After publication, check `--follow --status` on every host and report it like a manual deployment. Repositories that the pass reports as `blocked` or `failed` still need the actor named under "Report". The steps below remain the fallback for a host without the follower, a paused host, and the Hub, which the follower does not upgrade yet.

## Preconditions

1. The release tag `v<version>` exists, and the CLI release matrix and GitHub Release for that tag succeeded. The release carries `lervo-cli-<version>.tgz`, `release-artifact-manifest.json`, `release-sbom.cdx.json`, and `release-subjects.json`.
2. No open Lervo pull request is meant for this release.
3. Resolve hosts from `.lervo/environment-targets/` with `lervo environment query --target <target-id> --json`. The always-on host runs the Hub. Every host with a registered repository is in scope.

## Build the artifacts once, from the tag commit

1. Create a clean worktree at the tag commit, then install, build, and run `pnpm release:manifest:check` and `pnpm release:sbom:check`.
2. Download the verified CLI files into a release directory named for the version and short commit: `gh release download v<version> --dir <release-dir>`. From the tag worktree, run `node scripts/release/commands/cli-release-subjects.mjs verify <release-dir> --expected-tag v<version>`, and use the tarball only after it passes. These are the exact bytes the matrix verified, darwin native files included, so no host packs the CLI. Only for a release without these assets, pack with `packCliArtifact(<release-dir>, <version>)` from `scripts/distribution/lib/packed-cli-artifact.mjs` and keep the tarball, `apps/cli/release-artifact-manifest.json`, and `apps/cli/release-sbom.cdx.json` together.
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
   - Use `lervo host upgrade` ([ADR-0571](../../../docs/decisions/distribution/0571-install-the-verified-cli-on-each-host-and-roll-back-by-activation-id.md)) only when the installed CLI has it and `lervo host upgrade --from-release v<version> --repository kimjh96/lervo --json` (the plan) succeeds; until the first ADR-0569 release passes that plan, use the three manual steps below. After a successful plan, run the same command with `--apply` on each host and keep its output as `<release-dir>/<host>-host-upgrade.json`. It verifies the release assets, installs side by side, switches both links, runs `lervo --version` and a `node --check` parse check of `lervo-node` (not runtime health), and prints the activation id. Fix any PATH warning in the plan first. Roll back with `lervo host upgrade --rollback <activation-id> --apply`.
   - Install the tarball side by side in a new versioned directory, using the previous install's `package.json` dependency set with `@lervo/cli` pointing at the new tarball. The `file:` path must be the tarball's absolute path; check it with `grep -o 'file:[^"]*' package.json` before installing, because a shell-expanded home directory has been doubled before.
   - Atomically relink `lervo` and `lervo-node` to the new `dist/bin.js` and `dist/node-runtime.js`.
   - Record the previous and new targets in `<host>-global-cli-activation.json` in the release directory.
3. **Registered repositories on every host.**
   - Read each host's registry (`repositories.json` in the Lervo state directory), not a remembered list.
   - Run `scripts/upgrade-all.sh <release-dir>/<host>-upgrade-receipts` on each host; it implements the steps below.
   - For each repository, run `lervo upgrade --json`, then `lervo upgrade --apply --json`, and repeat until the status is `current` or `lervo_debt`. `--apply` plans again inside the exclusive window, so a background cycle cannot make it stale. No stage takes an approval (ADR-0561).
   - `lervo_debt` means Lervo holds a stage itself, for example a reviewed plan whose cross-check disagreed or had no admitted provider. Report it with its reason; it is not owner work.
   - Each receipt's `notices` name what changed and the one command that undoes it. Keep receipts under `<release-dir>/<host>-upgrade-receipts/`.
   - Never commit generated outputs into an owner's working branch. Report which repositories have uncommitted generated changes.
4. **Services and policy.**
   - Confirm the knowledge host service on each host runs the new CLI and is not burning CPU.
   - Keep delegation provider order identical across hosts.

## Report

Report each host and repository with its final status and every receipt notice with its undo command. Name any stage still blocked by repository content, such as a lint error, and say which actor resolves it. Name any Lervo debt with its reason. A blocked content stage is not a reason to skip the other repositories or hosts.
