# CLI version and release management

Lervo uses reviewed release-intent files to prepare `@lervo/cli` versions. Preparation may change repository bytes and create the exact release tag, but cannot stage or publish an npm package.

## Contributor intent

Add one intent when a pull request changes public CLI behavior or implementation in a private workspace package bundled into the CLI:

```bash
pnpm release:intent:create --impact patch --summary "Correct bounded diagnostics for unavailable provider entrypoints."
```

Use `patch` for a compatible correction, `minor` for compatible new behavior, and `major` for an incompatible public contract. Before 1.0, `minor` and `major` both advance the minor number; `major` preserves reviewed breaking-change meaning. A Conventional Commit `!` or `BREAKING CHANGE` marker requires matching `major` intent and never replaces it.

Tests, documentation, release-management files, and internal refactors outside the packed CLI dependency closure are exempt. Refactors inside the closure require intent because the checker cannot prove that packaged behavior is unchanged. CI rejects missing, malformed, content-ID-mismatched, or unnecessary records.

Before claiming repository completion, bind inspection to the exact task base:

```bash
pnpm release:completion:check --base <task-base-revision>
```

The local default uses the configured upstream merge base, then the latest reachable version tag, and includes staged, unstaged, and untracked work. Explicit bases remain authoritative for agents and CI. The check permits no-change, pending-intent, or exact prepared-release state. A prior document read, current workstream, successful check from an older revision, or terminal Stop result is not release evidence.

## Release pull request

On `main`, `.github/workflows/release-preparation.yml` aggregates pending intent into the fixed `lervo/release-cli` branch. Review the public version, sorted summaries in `.changes/current-release.md`, lockfile, release artifact manifest, SBOM, consumed intent, and exact source revision. New intent updates the same pull request. Preparation consumes every pending item; creation and loading fail closed above the configured 128-item bound. The queue is transient, not history.

The current release-note projection is replaced, never appended. No cumulative changelog or directory gains one file per release. Immutable Git revisions and GitHub Releases retain historical notes.

Preparation may consume intent only into the version calculated by the reviewed impact policy. The completion checker reconstructs intent from bounded Git ancestry and requires exact release-note, manifest, and SBOM versions; deleting intent and manually editing a package version does not satisfy completion.

Generated files retain their owners. The workflow runs frozen lockfile installation, the build, `release:manifest:update`, and `release:sbom:update`. Do not manually edit version-bound fields. A conflict or failed generator restores local inputs and fails the workflow for correction.

## Tag handoff and recovery

After the release pull request merges, the workflow verifies clean `main`, the versioned current release note, matching generated metadata, no remaining intent, and tag absence. It creates and pushes the annotated `v<version>` tag, then ensures one exact-revision tag-bound run exists for the three-platform packed-consumer pipeline, supported attestation work, and idempotent GitHub Release creation. The explicit dispatch is required because GitHub does not emit a second workflow trigger for a tag pushed with the repository workflow token.

If tag creation or matrix dispatch has an uncertain result, rerun the workflow. An exact annotated tag at the planned revision and an existing matrix run for that revision are recovered replays. A lightweight tag or a tag at another revision is a conflict. Do not move or delete it automatically; resolve Git authority separately, then rerun the exact plan.

Emergency corrections require new `patch` or reviewed higher-impact intent and the ordinary release pull request. V1 has no prerelease channel. Version preparation and tag creation prove only those Git operations; npm stage approval, Trusted Publisher configuration, and publication retain independent authorization.

See [ADR-0223](../decisions/release/packaging/0223-base-bound-cli-release-completion.md) for the base-selection, privacy, failure, and direct-main enforcement contract.
