# ADR-0188: Command-Driven Repository Layout Migration

- Status: accepted
- Decision date: 2026-08-23

Extended by [ADR-0193](0193-semantic-repository-and-agent-surface-migration.md), which adds repository-wide semantic document routing and provider-surface normalization.

## Context

General migration preserved existing paths, while individual structure commands required users to assemble repository-wide cleanup manually. Lervo self-migration needs one read-only, item-approved, identity-preserving, reference-updating, and recoverable command.

## Decision

`lervo migrate knowledge` first evaluates a layout profile. V1 recognizes root Markdown files whose filename role and H1 jointly identify product vision, architecture, execution specification, or a versioned roadmap. Standard root entrypoints—`README.md`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, and `CODE_OF_CONDUCT.md`—are never moved automatically.

Targets are `docs/product/vision.md`, `docs/architecture/system.md`, `docs/specifications/execution.md`, and `docs/roadmap/vN.md`. Existing, ambiguous, or out-of-policy targets block migration. CommonMark links within moved documents and exact repository-relative or source-relative path tokens in included text sources are parser-bound and updated to preserve their targets. Plans store only before/after hashes and counts, never bodies.

Each move requires its own approval hash binding the source bytes, destination, preserved lineage, and reference updates. A plan ID alone never changes user bytes. Apply places native moves and `move_update`, reference updates, lineage, and generated outputs in one durable journal. Failure before the event rolls back all changes; interruption uses existing recovery.

Success reuses `knowledge.materialization.applied` with `operation=migrate`, compiler `lervo.repository-layout@1`, and a digest of sorted approvals. Events omit paths, bodies, and reviewers; receipts use from/to path digests. Re-running must report the current layout and zero ordinary knowledge changes.

V1 performs exact moves only when the filename and H1 prove the role. Semantic splitting or merging, duplicate resolution, and ADR rewriting require separate candidates and review.

## Consequences

Fixtures verify grouped root classification, exact README and code-link updates, mandatory approvals, interruption rollback, CLI-only plan/apply/lint and no-op reruns, and Lervo's actual self-migration of four root design documents.
