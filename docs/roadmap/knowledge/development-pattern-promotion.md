# Evidence-bound development-pattern promotion

Status: `historical`
As of: 2026-08-26

Superseded by: [ADR-0533](../../decisions/knowledge/repository/canonicalization/patterns/0533-remove-the-development-pattern-pipeline.md). The implementation below is historical. [Background practice learning](background-practice-learning.md) is wired in the standalone resident; Hub typed exchange and installed acceptance remain open.

## Problem

Repository compilation discovers code, tests, instructions, skills, and documentation but cannot identify a repeated development approach as a durable convention or promote it automatically. Structural concepts and semantic compilations remain `unreviewed`; recurring review corrections and shared implementation invariants remain implicit until an agent or maintainer authors canonical guidance.

## Outcome

Codex and Claude can propose the same provider-neutral pattern candidate from bounded repository evidence. Reviewers can accept, reject, defer, or supersede it. Exact-approved promotion routes the result to the correct canonical surface without treating repetition, model agreement, or source presence as truth.

## Required contract

1. Define `observed -> candidate -> reviewed -> promoted|rejected|deferred -> superseded`, including stable identities, allowed transitions, required fields, privacy handling, and failure meanings.
2. Bind each candidate to current source units, independent occurrences, scope, exceptions, affected invariants, reasons to change, and verification. Similar syntax or a fixed occurrence count is insufficient evidence of a shared pattern.
3. Store candidate bodies and immutable review results in durable events and CAS. Keep lists, rankings, and current status in rebuildable state. Deleting `.lervo/state` must not erase a pending or reviewed decision.
4. Keep providers behind the existing capability-free compiler boundary. Provider overlap may increase review priority but never assurance or approval.
5. Route exact-approved promotions by responsibility: repository-wide obligations through `AGENTS.md` and foundation documentation; scoped behavior through `docs/instructions`; repeatable workflows through portable Agent Skills; design tradeoffs through ADRs; and automatable rules through lint or contract tests.
6. Preserve user-owned bytes and managed-block boundaries. Before approval, promotion planning must expose every target, replacement, verification, and agent route.
7. Keep query semantics at `recommended`; separately prove current-byte selection, loading, delivery, reference, or use.

## Completion criteria

- Codex and Claude produce schema-equivalent candidates from the same bounded evidence envelope.
- Review distinguishes promoted, rejected, deferred, and superseded patterns without deleting durable provenance.
- Every user-owned instruction, skill, decision, or convention change requires exact approval.
- A promoted pattern is reachable through current exact-byte agent routes, and its automatable portion is covered by an executed repository check where applicable.
- Source or verification changes mark affected candidates and promotions stale without automatically rewriting canonical guidance.
- An end-to-end Lervo dogfood case detects a recurring repository pattern, reviews and promotes it, delivers it to both provider paths, passes refresh and lint, and reproduces from a clean clone without a Hub.

## Dependencies

- [Repository knowledge specification](../../specs/repository-knowledge-compilation.md)
- [Typed repository agent-surface inventory](../../decisions/knowledge/repository/0189-typed-repository-agent-surface-inventory.md)
- [Code convention](../../foundation/code-convention.md)
- [Typed derived-state retention and bounded pruning](../operations/state-retention.md)

## Completion evidence

- Provider-neutral candidate identity binds a content snapshot, exact current source units, independent groups, exceptions, invariants, reasons, verification, and one responsibility-owned target. Codex/Claude overlap adds observations only.
- Candidate and review bodies are CAS artifacts; privacy-bounded observation and transition events rebuild current status after `.lervo/state` deletion. Review preserves accept, reject, defer, supersede, and provenance without automatic fact promotion.
- Exact promotion exposes every target hash, verification, and provider route, blocks conflicts and stale unapplied sources, mutates only new targets plus a Lervo-managed AGENTS block, and rolls back on durable-event failure.
- The Lervo dogfood candidate `pattern_736e0ad0b1fe0001ec9a44e1` converged Codex and Claude observations, received exact review, promoted `docs/instructions/evidence-bound-repository-changes.md`, and is reachable through AGENTS and the Claude bridge. Replanning is current while reporting stale pre-promotion provenance without rewriting the target.
- Focused end-to-end, schema, privacy, state reconstruction, repository quality, documentation, migration, and knowledge-lint checks cover the lifecycle.
