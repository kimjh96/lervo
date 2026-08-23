# ADR-0063: Search-adapter build identity and rebuildable replay receipts

Status: `accepted`
Decision date: 2026-08-20

## Context

Candidate/engine/version cannot distinguish implementation builds. Changed code may coincidentally reproduce outputs, while persisting every operational replay would accumulate derived state.

## Decision

- Every `SearchEnginePort` declares content-bound `adapterBuildId`; registry validates format/uniqueness with candidate and engine coordinates, and CLI lists it.
- Release manifests must change build ID when behavior/dependencies change. The declared ID does not prove module bytes, signature, or supply-chain identity.
- Schema-v2 comparisons/reviews include build ID in content IDs. Review, activation, refresh, and resolver compare stored/registry IDs before candidate calls. Missing/mismatch is `evaluation_candidate_build_mismatch`, never fallback.
- New activation/refresh requires v2 evidence. Read legacy v1 without insertion or ID recalculation; it may validate existing legacy selections but cannot create new review/activation/refresh.
- Successful v2 replay deterministically derives `SearchCandidateVerificationReceipt` from project/candidate/engine/build/comparison/review/corpus/run/index.
- Persist no receipt file/event/Hub source. Search/status expose only nullable receipt ID. It proves resolver replay at those coordinates, not query execution/use/quality.

Receipts/build IDs exclude query/digest, paths/bodies, prompts, results, credentials, and reasoning. Malformed build is invalid engine; tampered evidence/receipt uses existing invalid comparison/review semantics; operational wrapper stops as selection unavailable.

## Consequences

Replay evidence is build-bound without accumulating a second authoritative store or rewriting legacy sources.
