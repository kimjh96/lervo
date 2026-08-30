# ADR-0221: Reviewed CLI release preparation

Status: accepted
Date: 2026-08-26

## Context

Lervo verifies packed CLI bytes, manifests, SBOMs, attestations, and publication coordinates, but it did not own the preceding version decision. Inferring that decision from commit text would make release impact implicit. Giving the version workflow registry credentials would combine repository-preparation and publication authority.

## Decision

- Use the repository-native `lervo-release-intent` v1 format as a justified Changesets-style equivalent. `.changes/config.json` pins its schema, tool version, sole public package, pre-1.0 policy, bounded current release-note target, history authority, maximum 128 pending intents, and generated-file owners. Preparation consumes all pending intents. Creation and loading fail closed at the limit, preventing an unbounded one-file-per-change archive. This avoids another release runtime while preserving exact Lervo plan and recheck semantics.
- Each `.changes/relint_<digest>.yaml` contains only the schema version, content-derived ID, `@lervo/cli`, `patch|minor|major`, and a 20–280 character printable-English user summary. CLI or bundled-private implementation changes require one or more records. Only tests, documentation, release-management files, and refactors outside the CLI bundle are exempt. Reject intent without a publishable change.
- Before 1.0, `patch` increments the patch number, while `minor` and `major` increment the minor number. Conventional Commit `!` or `BREAKING CHANGE` evidence requires a reviewed `major` intent; commit text never creates or raises intent automatically. At and after 1.0, use ordinary semantic-version increments.
- Preparation aggregates the highest impact and sorted summaries into one CLI version and `.changes/current-release.md`, replacing that file for every release. Git and GitHub Releases retain history; there is no append-only changelog or per-release-file directory.
- The exact preparation plan binds the source revision, intent IDs and content hashes, current and next versions, file operations, and owner commands. Apply rechecks the plan, updates only the CLI manifest and current release note, consumes the exact intents, uses frozen lockfile generation, and invokes the build, release-manifest, and SBOM owners. On failure, restore every owned input and output.
- The main-branch workflow reconciles one `lervo/release-cli` branch and one open pull request through an exact ref update. It has repository, pull-request, and workflow-dispatch authority, but no npm authority. The same source and intents produce the same plan and bytes. Additional merged intent replaces the branch with a newly bound plan.
- After the preparation pull request merges, a separate exact plan requires clean `main`, no pending intent, matching package, current release-note, manifest, and SBOM versions, and no `v<version>` tag. Apply creates one annotated tag. An exact annotated tag at the same revision is a recoverable replay. A lightweight tag, same-name tag at another revision, or other conflict fails closed.
- After pushing a `v*` tag with the repository workflow token, release preparation queries tag-bound matrix runs at the exact release revision and dispatches the matrix only when none exists. This explicit handoff accounts for GitHub suppressing recursive workflow triggers from its repository token and converges safely on replay. The Linux, macOS, and Windows packed-consumer matrix then prepares supported exact attestation and publication-authorization artifacts. A private personal repository skips the unavailable attestation job. After the matrix succeeds and attestation succeeds or is skipped for capability, a separate contents-write job idempotently creates or updates the GitHub Release from the tag-bound current note. The workflows receive no npm credential and have neither staging approval nor publication authority.
- Plans and receipts expose only bounded identifiers, counts, versions, digests, dispositions, and failure codes. They exclude package bodies, changed paths, credentials, provider configuration, user documents, and unbounded child output. This contract adds no Lervo event or persistent runtime state: Git intent, pull request, commit, and annotated tag records are canonical.

## Consequences

Release impact is explicit and reviewable without independently versioning private packages. A private package in the CLI artifact closure still requires one coherent CLI intent; an unrelated private workspace change cannot create a public release. Version preparation, tag creation, npm stage approval, and npm publication remain separate authorities.

V1 has no prereleases. A prerelease channel, multiple public packages, or automatic publication requires a separate reviewed contract. Emergency correction uses a new exact intent and the same release pull request. Automation never moves or deletes tags.

## Verification

Tests cover intent validation and exact exemptions, bundled-private closure, deterministic aggregation and current-note replacement, patch/minor/major policy, stale input, generated-owner rollback, exact workflow permissions, clean-main tag success, replay, metadata mismatch, stale plans, conflicts, partial-result recovery, three-platform handoff, capability-aware attestation, and idempotent GitHub Release notes. Full repository checks and a clean-copy release rehearsal validate integrated owner commands without creating a tag or publishing to npm.
