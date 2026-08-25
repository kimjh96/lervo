# ADR-0221: Reviewed CLI release preparation

Status: accepted
Date: 2026-08-26

## Context

Lervo verifies packed CLI bytes, manifests, SBOMs, attestations, and publication coordinates, but did not own the preceding version decision. Inferring that decision from commit text would make release impact implicit; giving the version workflow registry credentials would collapse repository-preparation and publication authority.

## Decision

- Use the repository-native `lervo-release-intent` v1 format as a justified Changesets-style equivalent. `.changes/config.json` pins its schema, tool version, sole public package, pre-1.0 policy, changelog target, and generated-file owners. This avoids another release runtime while supporting exact Lervo plan and recheck semantics.
- A `.changes/relint_<digest>.yaml` record contains only the schema version, content-derived ID, `@lervo/cli`, `patch|minor|major`, and a 20–280 character printable-English user summary. CLI or bundled-private implementation changes require one or more records. Tests, documentation, release-management files, and refactors outside the CLI bundle are exact exemptions. An intent without a publishable change is rejected.
- Before 1.0, `patch` increments the patch number; `minor` and `major` both increment the minor number. Conventional Commit `!` or `BREAKING CHANGE` evidence requires a reviewed `major` intent, but commit text never creates or raises release intent automatically. At and after 1.0, ordinary semantic-version increments apply.
- Preparation aggregates the highest impact and sorted summaries into one CLI version and changelog entry. Its exact plan binds the source revision, source-commit date, intent IDs and content hashes, current and next versions, file operations, and owner commands. Apply rechecks the plan, updates only the CLI manifest and changelog, consumes the exact intents, uses frozen lockfile generation, and invokes the build, release-manifest, and SBOM owners. Failure restores every owned input and output.
- The main-branch workflow uses force-with-lease to reconcile one `lervo/release-cli` branch and one open pull request. It has only repository and pull-request authority. Rerunning against the same source and intents produces the same plan and bytes; additional merged intent replaces that branch with a newly bound plan.
- After the preparation pull request merges, a separate exact plan requires clean `main`, no pending intent, matching package, changelog, manifest, and SBOM versions, and an absent `v<version>` tag. Apply creates one annotated tag. An exact annotated tag at the same revision is a recoverable replay; any lightweight, same-name/different-revision, or otherwise conflicting tag fails closed.
- A pushed `v*` tag runs the existing Linux, macOS, and Windows packed-consumer matrix, then prepares and verifies exact attestation and publication-authorization artifacts. The version workflow receives no npm credential and grants neither staging approval nor publication authority.
- Plans and receipts expose bounded identifiers, counts, versions, digests, dispositions, and failure codes. They exclude package bodies, changed paths, credentials, provider configuration, user documents, and unbounded child output. This contract adds no Lervo event or persistent runtime state: Git intent, pull request, commit, and annotated tag records are canonical.

## Consequences

Release impact becomes explicit and reviewable without independently versioning private packages. A private package included in the CLI artifact closure still requires one coherent CLI intent; an unrelated private workspace change cannot create a public release. Version preparation, tag creation, npm stage approval, and npm publication remain separate authorities.

V1 does not create prereleases. A prerelease channel, multiple public packages, or automatic publication requires a separate reviewed contract. Emergency correction uses a new exact intent and the same release pull request; automation never moves or deletes tags.

## Verification

Tests cover intent validation and exact exemptions, bundled-private closure, deterministic date and aggregation, patch/minor/major policy, stale input, generated-owner rollback, exact workflow permissions, clean-main tag success, replay, metadata mismatch, stale plans, conflicts, partial-result recovery, and the tag-driven three-platform handoff. Full repository checks and a clean-copy release rehearsal validate the integrated owner commands without creating a tag or publishing to npm.
