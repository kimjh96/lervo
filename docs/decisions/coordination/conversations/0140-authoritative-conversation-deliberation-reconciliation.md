# ADR-0140: Reconcile Conversation Jobs with Project Sources

- Status: accepted
- Decision date: 2026-08-22

## Context

A worker may start managed execution and die before queue settlement. Replay risks duplication, but permanent unknown would hide completion or an approved resumable interruption. Project events, checkpoint, and lease—not the queue—are authoritative.

## Decision

A read-only coordinator and source port accept only an uncertain job whose project and deliberation IDs match. After validating a terminal or resume-candidate summary, compare-and-set changes uncertain to settled only if project, deliberation, and request hash remain unchanged.

The neutral contract carries a bounded sourceKind and SHA-256 evidence hash. The managed_deliberation_inspection_v1 adapter binds one project to one absolute root and validates the complete event chain, deliberation relationships, readable approved checkpoint, lease state, and manifest project.

A consistent completion recovers converged, no_consensus, or failed. Without completion, a readable approved checkpoint and no active lease recover interrupted/resume as a candidate only. Active execution, incomplete history, inconsistent source, and absent source return not_confirmed without mutation.

SQLite v2 adds reconciliation_json while preserving v1 jobs. Successful reconciliation stores only source kind, canonical inspection hash, prior failure code, uncertain time, and reconciliation time. It never copies events, checkpoint, topic, provider output, or raw errors. Concurrent equal results converge; results cannot be overwritten or deleted.

settled means only that the queue summary committed. It does not replace deliberation.completed, and interrupted is not completion. The app exposes reconciliation only when configured and performs no automatic scheduling, replay, or resume.

## Consequences

Only source-verified state is recovered after response loss. Active and pre-approval incomplete work remain unknown, and other executors can add adapters without coupling common storage to CLI providers.
