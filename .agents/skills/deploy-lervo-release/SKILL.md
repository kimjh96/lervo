---
name: deploy-lervo-release
description: Deploy a published Lervo CLI release to the whole fleet in one pass. Use whenever the owner asks to release, deploy, roll out, upgrade, or migrate Lervo, or after a `v<version>` tag and its CLI release matrix succeed. Covers the Hub, the global lervo CLI on every host, knowledge host services, delegations, and `lervo upgrade` on every registered repository.
---

# Deploy a Lervo release to the whole fleet

A deployment is never partial. Unless the owner names an exception, one deployment updates every item below on every host. Do not ask which parts to include.

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
   - Back up the Hub database with an online SQLite backup, then run an integrity check.
   - Install with `scripts/distribution/install-hub-runtime-distribution.mjs --archive --artifact --expected-sha256 --target <new-directory> --write`. Its scripts need only `packages/runtime-security/dist` from the tag build.
   - Render the service with `scripts/distribution/render-runtime-service.mjs` (runtime `hub`, same Node and config). Copy the current unit as the previous definition.
   - Switch with `scripts/distribution/manage-runtime-service.mjs --action upgrade ... --write`.
   - Verify `/v1/health/live`, `/v1/health/ready`, and that `/v1/health/capabilities` lists the new readable event schema versions. On failure, upgrade back to the previous definition.
2. **Global CLI on every host.**
   - Install the tarball side by side in a new versioned directory, using the previous install's `package.json` dependency set with `@lervo/cli` pointing at the new tarball.
   - Atomically relink `lervo` and `lervo-node` to the new `dist/bin.js` and `dist/node-runtime.js`.
   - Record the previous and new targets in `<host>-global-cli-activation.json` in the release directory.
3. **Registered repositories on every host.**
   - Read each host's registry (`repositories.json` in the Lervo state directory), not a remembered list.
   - For each repository, run `lervo upgrade --json`. Apply `--apply --approval <planId>`, and repeat until the status is `current`.
   - When a background cycle changes the plan during the wait (`upgrade_plan_changed`), use `lervo upgrade --apply --safe`.
   - Keep receipts under `<release-dir>/<host>-upgrade-receipts/`.
   - Never commit generated outputs into an owner's working branch. Report which repositories have uncommitted generated changes.
4. **Services and policy.**
   - Confirm the knowledge host service on each host runs the new CLI and is not burning CPU.
   - Keep delegation provider order identical across hosts.

## Report

Report each host and repository with its final status. Name any stage still blocked by repository content, such as a lint error, and say which actor resolves it. A blocked content stage is not a reason to skip the other repositories or hosts.
