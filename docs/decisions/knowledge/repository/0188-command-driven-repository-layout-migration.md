# ADR-0188: Command-Driven Repository Layout Migration

- Status: accepted
- Decision date: 2026-08-23

Extended by [ADR-0193](0193-semantic-repository-and-agent-surface-migration.md), which adds repository-wide semantic document routing and provider-surface normalization.

## Context

General migration preserved existing paths, while individual structure commands required users to assemble a repository-wide cleanup manually. Lervo self-migration needs one read-only, item-approved, identity-preserving, reference-updating, recoverable command.

## Decision

lervo migrate knowledge first evaluates a layout profile. V1 recognizes root Markdown whose filename role and H1 jointly identify product vision, architecture, execution specification, or versioned roadmap. Standard root entrypoints README.md, AGENTS.md, CLAUDE.md, CONTRIBUTING.md, SECURITY.md, CHANGELOG.md, and CODE_OF_CONDUCT.md never auto-move.

Targets are docs/product/vision.md, docs/architecture/system.md, docs/specifications/execution.md, and docs/roadmap/vN.md. Existing/ambiguous/out-of-policy targets block. CommonMark links inside moved documents and exact repository/source-relative path tokens in included text sources are parser-bound and updated to preserve targets. Plans store only before/after hashes and counts, not bodies.

Every move has its own approval hash binding source bytes, destination, preserved lineage, and reference updates. Plan ID alone never changes user bytes. Apply places native moves/move_update, reference updates, lineage, and generated outputs in one durable journal. Pre-event failure rolls all back; interruption uses existing recovery.

Success reuses knowledge.materialization.applied operation=migrate with compiler lervo.repository-layout@1 and a digest of sorted approvals. Events omit paths/bodies/reviewers; receipts use from/to path digests. Re-running must report current layout and zero ordinary knowledge changes.

V1 performs exact moves only when name and H1 prove role. Semantic split/merge, duplicate resolution, and ADR rewriting require separate candidates and review.

## Consequences

Fixtures verify grouped root classification, exact README/code link updates, mandatory approvals, interruption rollback, CLI-only plan/apply/lint/no-op rerun, and actual Lervo self-migration of four root design documents.
