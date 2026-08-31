# ADR-0320: Qualify projected lexical-v2 without engine activation

Status: `accepted`
Date: 2026-08-31

## Context

ADR-0319 retained `lexical-v1` after flattened provider projections failed the exact reviewed real-use suite. The follow-up implemented a provider-neutral `SearchQueryProjectorPort`, privacy-bounded receipts, independent-query execution, reciprocal-rank fusion, and deterministic query-coverage interleave while retaining the approved suite and all earlier gates.

Fresh five-repetition Codex and Claude runs passed every reviewed `lexical-v2` retrieval observation on the same 455-document corpus. This closes the real-use retrieval-quality defect, but the repository's immutable selection model selects and replays only one deterministic engine. The measured behavior is a complete dynamic plan, and terminal candidate retrieval currently bypasses operational engine selection.

## Decision

Qualify the projection-plus-`lexical-v2`-plus-fusion plan for plan-level activation implementation. Keep operational selection at `lexical-v1`; create no engine comparison, adoption review, policy, or transition from the plan report.

Do not encode projected queries as synthetic reviewed engine cases, treat provider output as deterministic replay, reuse the `lexical-v2` adapter build identity for the composition layer, or bypass the registered-corpus requirement. Each would omit a changed stage from immutable evidence.

The next activation contract must bind the complete ordered plan, constituent build identities, provider-independent stage schemas, corpus snapshot, projection receipts, fusion receipt, both provider populations, privacy disposition, failure behavior, latency and token accounting, and rollback target. Runtime resolution must rebuild the same corpus, validate every selected stage, and execute terminal retrieval through that selected plan. A required projector, retriever, or fusion failure fails closed; it cannot silently reduce to raw `lexical-v2` or `lexical-v1`.

External-only replacement, local-plus-external augmentation, and external reranking remain different plan identities. A plan registry may accept built-in or locked out-of-process adapters, but core search cannot import provider or vendor SDKs. Endpoint, credential, export, retention, and cost authority remain outside plan selection.

## New evidence and failure meaning

- `SearchQueryProjectionReceipt.usage` records normalized provider usage when observable. Its absence means usage is unobserved, not zero.
- `invalid_query_projection` means projection coordinates, limits, queries, or source consistency failed validation; no fused result is valid.
- `query_projection_missing` means no validated projected query reached terminal selection; no search occurs.
- A completed projection proves only bounded query production. A fused hit remains `selected`; it is not thereby loaded, injected, relevant, correct, or used.

## Consequences

The implementation provides a reusable provider-neutral projection and fusion boundary for local, external-only, augmented, and reranked plans. Codex and Claude pass the reviewed retrieval cases without query-specific fixes. Operational V2 remains inactive because a truthful plan-level transition and rollback chain do not exist.

## References

- [Replacement and composition](0306-separate-search-engine-replacement-and-composition.md)
- [Activation gates](0308-pre-register-lexical-v2-pipeline-activation-gates.md)
- [Prior real-use disposition](0319-keep-lexical-v2-inactive-after-reviewed-real-use-gate.md)
- [Reviewed real-use evidence](../../../evidence/search/lexical-v2/lexical-v2-reviewed-real-use-projection-v1.md)
