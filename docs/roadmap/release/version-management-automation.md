# Automated version and release preparation

Status: `complete`
Completed: 2026-08-26

## Problem

Lervo verified packed CLI bytes, release manifests, SBOMs, attestations, tag coordinates, and publication eligibility only after a version and tag were chosen. The repository lacked reviewed release intent, automated semantic-version calculation, bounded release-note generation, a release pull request, and exact tag creation. Package manifests were synchronized manually, and Conventional Commits validation did not establish intended release impact.

## Outcome

A reviewable Changesets-style lifecycle now records version intent with each publishable change, aggregates it into one release pull request, and creates the exact release tag after merge. Preparation replaces one bounded current release-note projection; Git and GitHub Releases retain history without an append-only repository log or one-file-per-release directory. The tag hands off to release-note publication, release artifacts, SBOMs, attestations, and publication authorization. Version preparation neither grants npm publication authority nor weakens first-publication or Trusted Publisher boundaries.

## Required contract

1. Select Changesets or a justified equivalent in an ADR. Pin the toolchain and define its configuration, release policy, and generated-file ownership.
2. Initially treat `@lervo/cli` as the only public package. Private workspace packages do not receive independent public versions or release notes merely because their source changed.
3. Require every pull request changing publishable CLI behavior to include bounded release intent: the affected public package, `patch`, `minor`, or `major` impact, and an English user-facing summary. Define exact exemptions for tests, internal refactors, documentation-only changes, and release-management changes; never infer exemptions from commit text alone.
4. Define the pre-1.0 compatibility policy before enabling automation, including how breaking changes map to versions and how Conventional Commit `!` or `BREAKING CHANGE` evidence is reconciled with reviewed release intent.
5. Aggregate pending intent into an idempotent release pull request that updates the canonical public-package version, lockfile coordinates, one replace-in-place current release note, and every version-bound generated release source through its owning command. Never accumulate a changelog or per-release file directory, and never patch release manifests, SBOMs, or attestations manually.
6. Bind release-pull-request content to the exact included intent records and source revision. New changes update the same open release pull request. Stale, missing, duplicated, or conflicting records fail closed with actionable diagnostics.
7. After the release pull request merges, verify the clean `main` revision, package version, current release-note version, generated release metadata, and absence of unconsumed intent before creating one annotated `v<version>` tag. A same-version or different-revision tag is a conflict, not a retry target.
8. After the tag matrix succeeds, create or reconcile one GitHub Release from the exact tag-bound current release note. Unsupported private personal-repository attestations may be skipped without losing release notes; a supported attestation failure still blocks the GitHub Release.
9. Tag creation automatically triggers the existing multi-platform release workflow, which revalidates the tag, source digest, tarball, manifest, SBOM, and attestations instead of trusting the release pull request.
10. Keep repository-write authority, tag authority, npm staging approval, and npm publication authority separate. The version workflow receives no registry credential and cannot publish, approve a stage, broaden Trusted Publisher configuration, or bypass existing human-approval contracts.
11. Record bounded automation results and failure meanings without package bodies, credentials, provider configuration, user documents, or unbounded CI output. A created release pull request or tag proves only that operation, not publication.

## Completion criteria

- An accepted ADR fixes the versioning model, pre-1.0 compatibility rules, chosen tool, public-package scope, release-intent schema, bounded current-note format, history retention, and authority boundaries.
- Repository configuration and CI reject missing, malformed, stale, duplicate, conflicting, or unnecessary release intent, with fixtures for publishable and exempt changes.
- A deterministic release-pull-request test covers initial creation, repeated no-op reconciliation, additional intent, patch/minor/major aggregation, bounded current-note replacement, conflict recovery, and exact generated-file ownership.
- Private workspace changes cannot accidentally create public-package releases; CLI changes crossing private-package boundaries still produce one coherent public CLI release.
- Tag automation covers exact-version success, version/tag mismatch, existing-tag conflict, stale `main`, replay, partial failure, and recovery without creating multiple tags.
- A tag-driven dry run completes the current Linux, macOS, and Windows packed-consumer matrix and produces verified release artifacts, SBOM, attestations, and publication authorization without publishing to npm.
- Documentation explains contributor intent files, release-pull-request review, emergency correction, prerelease policy, tag recovery, and the boundary between version preparation and publication approval.
- `pnpm check`, documentation lifecycle checks, and a clean-clone release rehearsal pass before completion.

## Completion evidence

- [ADR-0221](../../decisions/release/packaging/0221-reviewed-cli-release-preparation.md) fixes the repository-native v1 intent format, sole-public-package scope, pre-1.0 version policy, exact plan/apply contract, Git tag recovery, privacy, and separate authorities.
- [CLI version and release management](../../distribution/cli-version-management.md) documents contribution, pull-request review, emergency correction, no-prerelease policy, tag recovery, and publication non-authority.
- `.changes/config.json`, the release-intent checker, deterministic preparation and tag commands, the fixed release branch workflow, and tag-triggered release matrix implement the lifecycle. Focused tests cover publishable and exempt paths, bundled private packages, deterministic aggregation, generated-owner rollback, stale inputs, tag mismatch, conflict, replay, recovery, and workflow permissions.
- Repository checks, documentation migration and lint, and the clean-copy rehearsal completed without creating a release tag, granting npm stage approval, or publishing a package.

## References

- [V0 and post-v0 roadmap](../v0.md)
- [Repository commit convention](../../foundation/commit-convention.md)
- [Supported-runtime release portability](../../decisions/release/packaging/0215-supported-runtime-release-portability.md)
- [CLI multi-platform release matrix](../../decisions/release/packaging/0089-cli-multi-platform-release-matrix.md)
- [CLI first-publication bootstrap](../../decisions/release/bootstrap/0097-cli-first-publication-bootstrap.md)
- [Reviewed CLI release preparation](../../decisions/release/packaging/0221-reviewed-cli-release-preparation.md)
