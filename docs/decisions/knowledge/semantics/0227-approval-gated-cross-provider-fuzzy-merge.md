# ADR-0227: Approval-gated cross-provider fuzzy merge

Status: `accepted`
Decision date: 2026-08-27

## Context

ADR-0187 permits only exact cross-provider overlap. Provider outputs may express the same source-backed claim differently, but choosing a provider by default would treat similarity as truth and bypass repository review authority. Embedding or judge-based matching would add a provider or service dependency before measured scale requires one.

## Decision

Add `knowledge fuzzy-merge-candidate` as a separate deterministic local derivation. It revalidates the current Codex and Claude candidate artifacts and exact comparison ID. It considers only concepts excluded from exact concept and exact claim overlap, requires the same concept type and at least one shared evidence-unit version, and compares only normalized Unicode tokens from claim statements.

V1 uses Sørensen–Dice token similarity with a 0.60 threshold, at least two shared tokens, and a mutual-best margin of 0.10 for both providers. A tied or near-tied alternative is ambiguous and produces no pair. The command fails closed if no pair qualifies and rejects more than 64 qualifying pairs instead of truncating. It performs no provider call, embedding lookup, network access, Hub request, relation inference, or truth judgment.

Each accepted pair produces two remapped `unreviewed` concepts, preserving both provider candidates. The immutable derivation binds the comparison, both source artifact hashes, algorithm and thresholds, match ID, score, source concept IDs, and remapped candidate IDs. The artifact remains local state. Output is limited to bounded identifiers, scores, counts, and hashes; source bodies remain owner-only. Candidate creation emits no event and establishes neither consensus nor approval.

Reconciliation labels both members `fuzzy_cross_provider_candidate`, makes each a review-required conflict, and assigns an exact resolution hash. `accept-all-safe` cannot select either member. Only a tracked policy with `hash_bound_resolution` may authorize selection. The duplicate-group rule permits review to accept at most one member of each fuzzy pair. Materialization recomputes the plan and produces only `human_reviewed` knowledge. Skipping both is valid; accepting both rejects the complete review without partial application.

This decision amends only ADR-0187's exclusion of fuzzy merge. Exact merge remains the unchanged default. Automatic fact promotion, fuzzy relations, cross-language semantic inference, embeddings, model judges, and external graph or Hub semantic services remain out of scope.

## Failure meaning

- `knowledge_plan_stale`: the comparison, source candidate, repository snapshot, policy, or later reconciliation binding changed.
- `knowledge_reconciliation_conflict`: no sufficiently strong, source-backed, mutually unambiguous pair exists.
- `knowledge_source_limit_exceeded`: more than 64 pairs satisfy the bounded contract.
- `knowledge_review_not_eligible`: policy authorization, exact resolution hash, complete disposition review, or one-member-only selection is invalid.

No failure claims that a pair is equivalent, reviewed, merged, current, or true.

## Verification

Package fixtures cover qualifying paraphrases, weak similarity, mutual ambiguity, deterministic storage, review-required reconciliation, and bounded metadata. Packed CLI fixtures cover comparison through candidate creation, rejection when both members are selected, exact selection of one member, materialization, and lint. Common Codex and Claude compilation contracts remain unchanged because the derivation runs behind neither provider adapter.

## Consequences

Cross-provider fuzzy candidates remain local, deterministic, review-gated, and incapable of automatic fact promotion. Exact merge remains the default.

See [ADR-0180](0180-hash-bound-human-conflict-resolution.md), [ADR-0187](../../execution/providers/0187-review-gated-cross-provider-exact-merge.md), and the [repository knowledge compilation specification](../../../specs/repository-knowledge-compilation.md).
