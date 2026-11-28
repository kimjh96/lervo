# ADR-0659: Bound review instructions by bytes, not by count

Status: `accepted`
Decision date: 2026-11-28
Amends: [ADR-0443](../repository/canonicalization/0443-load-linked-child-contracts-for-canonical-review.md) (an aggregate over the byte bound no longer always fails)
Related: [ADR-0532](../maintenance/0532-continue-background-review-past-capacity-and-optional-context-failures.md), [ADR-0304](0304-bounded-instruction-registry-and-semantic-durable-rule-intake.md), [review evidence and assignments](../../../specs/background-knowledge-convergence/runtime/discovery-and-progress/discovery-and-stages/review-evidence-and-assignments.md)

## Context

Canonical review context loads every applicable instruction document: the `AGENTS.md` chain of the reviewed paths and each owner rule under `docs/instructions/generated/`. Since 2026-10-03 it refused more than eight of them with `review_context_limit_exceeded`. Eight instructions at the 128 KiB read bound fill the 1 MiB context, so the count stood in for the byte bound.

Owner rules accumulate through instruction intake, and none of them is scoped by paths. On 2026-11-28, `~/Lervo/axli` reached its first standalone knowledge owner (ADR-0655, ADR-0656) with 14 owner rules plus `AGENTS.md`. Background convergence then stopped at `assessment` with `review_context_limit_exceeded` on every cycle. The 15 instructions total a few kilobytes. Lervo's own repository has as many rules. Every project that records more than seven owner rules would stop background knowledge maintenance for good, against the owner's rules that new projects get automatic maintenance and that Lervo never silently stops.

A second check failed the whole review when the optional context exceeded 1 MiB, although an optional recommendation can be left out without weakening the review.

## Decision

1. **Bytes bound the instructions, not their count.** Every applicable instruction reaches the reviewer. The count bound is 256, a sanity limit far above any real instruction set. Instructions beyond eight add document slots instead of displacing candidates, so review context for up to eight instructions is unchanged.
2. **Required documents are never dropped.** When the instructions alone exceed 1 MiB, the review stops with `review_context_limit_exceeded` and names the largest instruction as its `documentPath`. The owner can shorten it, and the resident retries when it changes.
3. **Optional recommendations give way first.** When the whole context exceeds 1 MiB, the lowest-ranked general recommendations are left out, each recorded as a `context_budget` context skip. Instructions, documents the sources link to, focused hits, and linked contracts (ADR-0443) stay. If they alone still exceed the bound, the review stops and names the largest of them.
4. **Consumers trim no further than the loader.** Canonical assessment keeps every instruction and up to `reviewContextCandidateLimit(instructions)` candidates, the loader's own limit, so it never cuts a linked contract the loader kept. A candidate it leaves out anyway is recorded as a `context_budget` skip. The conversation knowledge review sends every instruction and the loader's eight highest-ranked candidates; its provider input byte bound still applies.
5. **The attention item names the cause.** The `convergence_attention` remediation for `review_context_limit_exceeded` says that the required review context exceeds 1 MiB and that shortening the largest instruction or contract clears it.

## Consequences

- Projects with many owner rules keep background knowledge maintenance.
- A review can now run without some low-ranked recommendations; the skips are recorded with the context, never silently.
- A required context over 1 MiB still stops, but visibly, with a document to shorten instead of a bare limit.
