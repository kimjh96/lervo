# ADR-0220: Evidence-bound development-pattern promotion

Status: `historical`
Date: 2026-08-26

Amended by: [ADR-0533](canonicalization/patterns/0533-remove-the-development-pattern-pipeline.md). The development-pattern pipeline is historical and its commands are removed.

## Context

Repository compilation can discover repeated structures, but repetition, provider agreement, and source presence do not establish a convention. Review corrections and implementation invariants therefore remained implicit, while automatic promotion would incorrectly make model output repository authority.

## Decision

- Development patterns follow `observed -> candidate -> reviewed -> promoted|rejected|deferred -> superseded`. A deferred candidate may return to review; terminal outcomes retain immutable provenance. Stable pattern identity excludes provider identity and binds a current content snapshot, at least two independently grouped exact source units, exceptions, affected invariants, reasons to change, verification commands, and one responsibility-owned target.
- Codex and Claude are observation adapters to one provider-neutral candidate contract. Matching candidate bytes add provider observations and review priority only; they do not change assurance, freshness, or approval.
- Candidate and review bodies live in owner-only CAS. `development.pattern.observed` and `development.pattern.transitioned` events retain bounded identity, artifact, hash, state, target-kind, approval, count, provider, and time coordinates. The current list is a rebuildable `.lervo/state` projection reconstructed from events and CAS.
- Review requires the exact candidate content hash and records accept, reject, defer, or supersede. Promotion is a separate exact plan/apply transaction exposing every target, replacement hash, verification command, and Codex/Claude agent route. Plan telemetry never includes candidate or target bodies.
- Target ownership is explicit: repository obligations use foundation or instruction Markdown; scoped behavior uses `docs/instructions`; portable workflows use `.agents/skills/*/SKILL.md`; tradeoffs use ADR paths; and checks use `scripts/check-*.mjs`. V1 creates a new exact target or accepts identical bytes; conflicting existing user bytes block. Non-check targets add or extend only the Lervo-managed AGENTS route block. Claude reaches the same exact route through its AGENTS import.
- A changed source snapshot marks a candidate stale and blocks a not-yet-applied promotion. It does not rewrite or delete an already promoted canonical target; a current plan reports the stale source separately.
- Every repository-changing completion performs a typed canonicalization assessment. It routes by source responsibility, ownership, and lifecycle coordinates rather than request keywords. The assessment may update an already authorized canonical source, create a review candidate, or record a bounded pending decision; it never turns the workstream or conversation memory into canonical truth.

## Consequences

Pattern candidates survive state deletion without becoming canonical facts. Providers can independently produce schema-equivalent observations, while review and promotion remain provider-neutral and local-first. Rejected, deferred, superseded, and stale evidence remains inspectable. New target kinds or automatic pattern detectors require their own bounded adapter and cannot bypass exact review.

The initial dogfood pattern promotes the recurring exact-plan, recheck, privacy-bounded-event, and rollback contract into [Evidence-bound repository changes](../../../instructions/evidence-bound-repository-changes.md). Both provider entrypoints reach it through the managed repository route.

## Verification

The end-to-end CLI test creates matching Codex and Claude observations, defers and then accepts review, promotes exact target and route bytes, recreates current status after deleting state, and confirms that a stale source does not rewrite the promoted target. Schema and privacy tests validate bounded events; repository verification and knowledge lifecycle checks validate the promoted route.
