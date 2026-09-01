# Automated version and release preparation

Status: `complete`
Completed: 2026-08-26

## Problem

Release verification previously began only after selecting a version and tag. The repository lacked reviewed release intent, automated semantic-version calculation, bounded release notes, release pull requests, and exact tag creation. Package manifests were synchronized manually, and Conventional Commit validation did not establish intended release impact.

## Outcome

A Changesets-style lifecycle now records version intent for each publishable change, aggregates it into one release pull request, and creates the exact release tag after merge. Preparation replaces one bounded current release-note projection; Git and GitHub Releases retain history without an append-only repository log or per-release directory.

The tag hands off to release-note publication, artifacts, SBOMs, attestations, and publication authorization. Version preparation grants no npm publication authority and preserves first-publication and Trusted Publisher boundaries.

## Required contract

1. Select Changesets or a justified equivalent in an ADR. Pin its toolchain and define configuration, release policy, and generated-file ownership.
2. Initially treat `@lervo/cli` as the only public package. Source changes do not give private workspace packages independent public versions or release notes.
3. Every pull request changing publishable CLI behavior must declare the affected public package, `patch`, `minor`, or `major` impact, and an English user-facing summary. Define exact exemptions for tests, internal refactors, documentation-only changes, and release-management changes; never infer exemptions from commit text alone.
4. Before automation, define the pre-1.0 compatibility policy, including breaking-version mapping and reconciliation of Conventional Commit `!` or `BREAKING CHANGE` evidence with reviewed release intent.
5. Idempotently aggregate pending intent into one release pull request. Update the canonical public-package version, lockfile coordinates, one replace-in-place current release note, and all version-bound generated release sources through their owning commands. Do not accumulate changelogs or per-release files, or manually patch release manifests, SBOMs, or attestations.
6. Bind release-pull-request content to the exact intent records and source revision. New changes update the same open pull request. Stale, missing, duplicate, or conflicting records fail closed with actionable diagnostics.
7. After merge, verify the clean `main` revision, package version, current release-note version, generated release metadata, and absence of unconsumed intent before creating one annotated `v<version>` tag. A same-version or different-revision tag is a conflict, not a retry target.
8. After the tag matrix succeeds, create or reconcile one GitHub Release from the exact tag-bound current release note. Unsupported private personal-repository attestations may be skipped without losing release notes; supported attestation failures block the GitHub Release.
9. Tag creation triggers the existing multi-platform release workflow, which revalidates the tag, source digest, tarball, manifest, SBOM, and attestations instead of trusting the release pull request.
10. Keep repository-write, tag, npm staging-approval, and npm publication authorities separate. The version workflow has no registry credential and cannot publish, approve a stage, broaden Trusted Publisher configuration, or bypass human approval.
11. Record bounded automation results and failure meanings without package bodies, credentials, provider configuration, user documents, or unbounded CI output. A release pull request or tag proves only its own creation, not publication.
12. Enforce reviewed release completion against an exact base for local checks, pull requests, direct-main pushes, and release preparation. Accept current intent or exact prepared-release evidence; never rely on prompt retrieval, session memory, workstream status, or terminal Stop.
13. Bind standalone Hub and Node distribution identity to the public Lervo release version. Private workspace versions remain implementation coordinates and must not become operational release identities. Release-impact inspection includes standalone builders, verifiers, installers, copied assets, and runtime workspace closures.

## Completion criteria

- An accepted ADR fixes the versioning model, pre-1.0 rules, tool, public-package scope, intent schema, bounded current-note format, history retention, and authority boundaries.
- Configuration and CI reject missing, malformed, stale, duplicate, conflicting, or unnecessary intent, with publishable and exempt fixtures.
- Deterministic release-pull-request tests cover initial creation, repeated no-op reconciliation, added intent, patch/minor/major aggregation, bounded-note replacement, conflict recovery, and exact generated-file ownership.
- Private workspace changes cannot accidentally create public releases; CLI changes crossing private-package boundaries still create one coherent public CLI release.
- Tag automation covers exact-version success, version/tag mismatch, existing-tag conflict, stale `main`, replay, partial failure, and recovery without duplicate tags.
- A tag-driven dry run completes the Linux, macOS, and Windows packed-consumer matrix and produces verified artifacts, SBOM, attestations, and publication authorization without npm publication.
- Documentation covers contributor intent files, release-pull-request review, emergency correction, prerelease policy, tag recovery, and the boundary between preparation and publication approval.
- A base-bound completion fixture rejects missing intent and manual version bypass, accepts pending intent and exact consumed preparation, and verifies local, pull-request, direct-main, and release-workflow integration.
- `pnpm check`, documentation lifecycle checks, and a clean-clone release rehearsal pass before completion.

## Completion evidence

- [ADR-0221](../../decisions/release/packaging/0221-reviewed-cli-release-preparation.md) defines the repository-native v1 intent format, sole-public-package scope, pre-1.0 policy, exact plan/apply contract, Git tag recovery, privacy, and separate authorities.
- [CLI version and release management](../../distribution/cli-version-management.md) documents contribution, pull-request review, emergency correction, the no-prerelease policy, tag recovery, and publication non-authority.
- `.changes/config.json`, the intent checker, deterministic preparation and tag commands, fixed release-branch workflow, and tag-triggered release matrix implement the lifecycle. Tests cover publishable and exempt paths, bundled private packages, deterministic aggregation, generated-owner rollback, stale inputs, tag mismatch, conflict, replay, recovery, and workflow permissions.
- [ADR-0223](../../decisions/release/packaging/0223-base-bound-cli-release-completion.md), `release:completion:check`, and workflow fixtures bind local and CI completion to exact Git evidence and close the direct-main gap.
- [ADR-0330](../../decisions/release/packaging/0330-release-bound-standalone-runtime-version.md) binds standalone Hub and Node manifests, SBOM roots, and artifact sidecars to the public release coordinate.
- Repository checks, documentation migration and lint, and the clean-copy rehearsal completed without creating a release tag, granting npm stage approval, or publishing a package.

## References

- [V0 and post-v0 roadmap](../v0.md)
- [Repository commit convention](../../foundation/commit-convention.md)
- [Supported-runtime release portability](../../decisions/release/packaging/0215-supported-runtime-release-portability.md)
- [CLI multi-platform release matrix](../../decisions/release/packaging/0089-cli-multi-platform-release-matrix.md)
- [CLI first-publication bootstrap](../../decisions/release/bootstrap/0097-cli-first-publication-bootstrap.md)
- [Reviewed CLI release preparation](../../decisions/release/packaging/0221-reviewed-cli-release-preparation.md)
