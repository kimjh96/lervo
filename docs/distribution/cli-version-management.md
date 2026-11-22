# CLI version and release management

Lervo uses reviewed release-intent files to prepare `@lervo/cli` versions. Preparation may change repository bytes and create the exact release tag, but cannot stage or publish an npm package.

## Contributor intent

Add one intent when a pull request changes:

- Public CLI behavior.
- Implementation in a private workspace package bundled into a released artifact.
- Standalone Hub or Node distribution tooling or copied assets.
- The runtime service renderer or manager bundled by the CLI.

```bash
pnpm release:intent:create --impact patch --summary "Correct bounded diagnostics for unavailable provider entrypoints."
```

Use `patch` for a compatible correction, `minor` for compatible new behavior, and `major` for an incompatible public contract. Before 1.0, `minor` and `major` both advance the minor number, while `major` retains the reviewed breaking-change meaning. A Conventional Commit `!` or `BREAKING CHANGE` marker requires matching `major` intent and never replaces it.

Tests, documentation, release-management files, and internal refactors outside every released-artifact closure are exempt. Refactors inside the CLI, Hub, or Node closure require intent because the checker cannot prove packaged behavior is unchanged. CI rejects missing, malformed, content-ID-mismatched, or unnecessary records. Hub and Node use `@lervo/cli` as their sole product release coordinate; their private workspace versions are not independent releases.

Before claiming repository completion, bind inspection to the exact task base:

```bash
pnpm release:completion:check --base <task-base-revision>
```

The local default uses the configured upstream merge base, then the latest reachable version tag, and includes staged, unstaged, and untracked work. Explicit bases remain authoritative for agents and CI. The check permits only no-change, pending-intent, or exact prepared-release state. A prior document read, current workstream, successful check from an older revision, or terminal Stop result is not release evidence.

## Prepared feature pull request

Prepare the release inside the feature pull request, so one full CI run covers the exact bytes that the tag later names. Add the `release` label to a same-repository pull request (create the label once with `gh label create release`), or run `gh workflow run release-pull-request.yml -f pull_request=<number>`. `.github/workflows/release-pull-request.yml` builds the darwin native bytes that CI verifies. It restores a verified `main` build of identical native inputs on Linux, or else compiles them on macOS with the image and Xcode that CI's native build uses ([ADR-0581](../decisions/release/packaging/0581-build-darwin-native-files-with-one-pinned-xcode.md), [ADR-0593](../decisions/release/packaging/0593-start-the-release-matrix-after-verification-and-prepare-on-linux.md)). It adds one `lervo-release[bot]` commit, `chore(cli): prepare release`, on top of current `main`. That commit holds the version, `.changes/current-release.md`, the consumed intent, the lockfile, the manifest, and the SBOM. The workflow then dispatches full Code quality for that exact commit, distribution checks included. Once that run passes, Code quality starts the CLI release matrix for the commit. The matrix verifies the packed CLI on Linux, macOS, and Windows and keeps the exact tarball, manifest, and SBOM, bound to the commit's tree, as the release subjects.

The intent commit and the preparation commit must stay separate, because the completion checker rebuilds intent from the commit that added it. Squashing them into one commit blocks completion. Merge with a merge commit after both dispatched runs pass. When `main` moves first, rerun preparation: it replaces its own commit, merges `main`, and prepares again. After the merge, main reuses the build, tests, and distribution checks by exact tree. Release preparation then goes straight to the tag check. See [ADR-0564](../decisions/operations/services/0564-prepare-the-release-inside-the-feature-pull-request.md) for triggers, failure codes, and the same-version race.

## Fallback release pull request

Intent that reaches `main` unprepared takes the fallback path, for example from an external contribution. On `main`, `.github/workflows/release-preparation.yml` aggregates that pending intent into the fixed `lervo/release-cli` branch. Review the public version, sorted summaries in `.changes/current-release.md`, lockfile, release artifact manifest, SBOM, consumed intent, and exact source revision. New intent updates the same pull request.

Preparation now follows successful verification of the exact current main push, rather than every push immediately. It generates a reviewable candidate and explicitly dispatches full CI for that exact candidate. The PR leaves verification pending until those checks pass. Generation no longer repeats `pnpm check`; source-main success does not prove the generated candidate passed. Manual preparation retries require current main and exact successful CI evidence. See [ADR-0496](../decisions/operations/services/0496-share-exact-ci-builds-and-separate-release-generation-from-verification.md).

Preparation consumes every pending item. Creation and loading fail closed above the 128-item bound. The queue is transient, not history. The current release-note projection is replaced, never appended. No cumulative changelog or directory receives one file per release; immutable Git revisions and GitHub Releases retain historical notes.

Preparation may consume intent only into the version calculated by the reviewed impact policy. The completion checker reconstructs intent from bounded Git ancestry and requires exact release-note, manifest, and SBOM versions. Deleting intent and manually editing a package version does not satisfy completion.

Generated files retain their owners. Both preparation workflows run frozen-lockfile installation, the build, `release:manifest:update`, and `release:sbom:update`. Do not manually edit version-bound fields. A conflict or failed generator restores local inputs and fails the workflow for correction.

## Darwin native files

Only macOS can compile `file-sync-darwin.node` and `cas-io-darwin.node`, and the release manifest records their exact bytes. Code quality compiles them on `macos-15` only when no build on `main` with identical native inputs exists. Only builds on `main` are offered for reuse, because a pull-request branch controls its own workflow. The inputs are the C sources and headers, the build scripts, the shared native contracts, the pinned Xcode, and the Node version. Otherwise a Linux job restores the earlier bytes after validating them against the current checkout. Both release preparations reuse them the same way. The daily audit compiles and requires equal bytes, and the CLI release matrix still compiles them from the exact tree for every release. See [ADR-0590](../decisions/release/packaging/0590-reuse-verified-darwin-native-builds-for-identical-inputs.md).

## Release metadata between releases

Release preparation is the only routine writer of `apps/cli/release-artifact-manifest.json` and `apps/cli/release-sbom.cdx.json`. An ordinary pull request does not regenerate or commit them, even when it changes bundled code, the CLI README, or the CLI's dependencies. Code quality decides per run how to verify them:

- `exact`: the committed files must equal the build. This applies when the tree's CLI version has no `v<version>` tag yet, when the change edits either file, or when the change cannot be determined. Prepared pull requests, the fallback candidate, and `main` between a release merge and its tag are always `exact`. An unprepared pull request that keeps its base's untagged version and leaves both files alone is `generated`, because no tag names a pull request merge commit ([ADR-0588](../decisions/release/packaging/0588-generate-release-metadata-for-pull-requests-before-the-release-tag.md)).
- `generated`: the build generates both files, and the run summary lists what changed against the committed ones. A platform package family that the committed manifest does not approve still fails, so it needs an exact edit. The generated files are uploaded as `lervo-cli-release-metadata`, and the test shards and distribution checks of that run use them.

The committed files on `main` can therefore describe an older build until the next preparation. Nothing publishes or installs from them in that state: a release commits exact metadata, and tag admission requires an exact run. Locally, `pnpm release:metadata:check` (part of `pnpm check`) skips the metadata checks with an explanation once the version is tagged. Merge through `wait-release.sh pr`, which requires a head on current `main` and holds an unprepared head until `main`'s version is tagged; otherwise a merge can turn `main` red after a release merge and delay its tag. See [ADR-0572](../decisions/release/packaging/0572-commit-cli-release-metadata-only-when-a-release-is-prepared.md).

## Tag handoff and recovery

After a prepared pull request or the fallback release pull request merges, the workflow verifies clean `main`, the versioned current release note, matching generated metadata, no remaining intent, and tag absence. It creates and pushes the annotated `v<version>` tag, then ensures one exact-revision, tag-bound run exists for the three-platform packed-consumer pipeline, supported attestation work, and idempotent GitHub Release creation. Explicit dispatch is required because GitHub does not emit another workflow trigger for a tag pushed with the repository workflow token.

When a successful pre-merge matrix run verified the same tree, the tag run skips the build and publishes that run's release subjects. Otherwise it runs the full matrix and publishes its own. Before publication, it checks the subjects against the tagged tree: their binding, digests, the committed manifest and SBOM bytes, the tarball's file list, and its `package.json`. If the tag run fails, re-run all of its jobs rather than only the failed one, so `plan` decides again. The GitHub Release then carries `lervo-cli-<version>.tgz`, `release-artifact-manifest.json`, `release-sbom.cdx.json`, and `release-subjects.json`. Reuse applies to any tag run, because the attestation job signs the verified subjects themselves rather than a rebuild. See [ADR-0569](../decisions/release/packaging/0569-verify-the-release-matrix-before-merge-and-publish-its-exact-subjects.md).

The tag effect also requires full successful Code quality evidence for the exact merged main revision, including all four test shards, manifest/SBOM, distribution smokes, and aggregate verification. A successful candidate or documentation-only run cannot substitute for that evidence; main satisfies it by reusing a prepared pull request's run only for the identical tree. Superseded main or unavailable CI stops the effect; retry after the current full verification completes.

If tag creation or matrix dispatch has an uncertain result, rerun the workflow. An exact annotated tag at the planned revision and an existing matrix run for that revision are recoverable replays. A lightweight tag or a tag at another revision is a conflict. Do not move or delete it automatically; resolve Git authority separately, then rerun the exact plan.

Emergency corrections require new `patch` or reviewed higher-impact intent and the ordinary preparation path. V1 has no prerelease channel. Version preparation and tag creation prove only those Git operations; npm stage approval, Trusted Publisher configuration, and publication retain independent authorization.

See [ADR-0223](../decisions/release/packaging/0223-base-bound-cli-release-completion.md) for the base-selection, privacy, failure, and direct-main enforcement contract.
