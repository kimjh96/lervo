# ADR-0333: Record causal work before managed execution

- Status: `accepted`
- Decision date: 2026-09-01

## Context

Envelope version 2 and `work.causality.recorded` were readable, but managed execution still began with `run.requested`. Token, timing, retry, subagent, and deliberation evidence therefore lacked a trustworthy request-wide tree. Inferring one later from timestamps, sessions, assignments, or prose would turn correlation into false ancestry.

## Decision

Every current managed provider run records exactly one schema-version-2 causal event in the same transaction and immediately before `run.requested`. A version-1 writer cannot perform this transaction, so it blocks before provider startup or partial run admission. Root work and causal event IDs are deterministic functions of project and run coordinates, enabling exact crash recovery without allowing an admitted run to execute twice.

`@lervo/execution-contract` owns pure payload, root, parent, retry, work-tree, cycle, idempotency, and historical projection invariants. `@lervo/orchestrator` collects bounded canonical history, resolves root or caller-supplied child coordinates, and performs the admission transaction. Provider adapters receive no causal policy. SQLite enforces unique constraints for one causal event per run and one root per work so concurrent writers cannot bypass the in-process check.

A managed deliberation atomically records one provider-free control root before `deliberation.started`. Its role runs use `deliberation` children, and its semantic publication checks use `publication_evaluation` children. Resume derives the same root from immutable runtime coordinates. Ordinary CLI runs bind the current workstream ID when one exists, but work identity grants no workstream, assignment, acceptance, or completion authority.

New child admission requires an already recorded parent in the same work. Retry requires an already recorded target in the same work and exactly the next attempt ordinal. Missing parents, foreign-work parents, multiple roots, conflicting run bindings, invalid retries, cycles, over-bound source history, and event-store failure all fail before provider startup. Historical requested runs without a causal event project only as `legacy_unlinked`; readers never invent ancestry.

## Privacy and failure meaning

The event retains only opaque work, run relationship, attempt, optional workstream, assignment, and agent coordinates. It excludes objectives, task prose, prompts, provider output, paths, credentials, approvals, and completion claims. A recorded root or child proves only immutable causal admission, not provider startup, execution, success, use, or correctness.

## Consequences

Current managed paths share one provider-neutral causal contract, and later resource, timing, graph, and loop projections can join on stable work coordinates. Writer activation is a prerequisite for managed execution, not merely a capability advertisement. The 100,000-event admission read is an explicit initial bound; FH4 must replace or justify it with capacity and adverse-condition evidence, never silently make the scan unbounded.

## References

- [ADR-0331](0331-adopt-reader-first-causal-work-observability.md)
- [Foundation-hardening delivery tracks](../../../roadmap/foundation-hardening/delivery-tracks.md)
- [Execution events and privacy](../../../specifications/execution/events-and-privacy.md)
