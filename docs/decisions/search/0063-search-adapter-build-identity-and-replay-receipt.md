# ADR-0063: Search-adapter build identity and rebuildable replay receipts

Status: `accepted`
Decision date: 2026-08-20

## Context

Candidate, engine, and version coordinates cannot distinguish implementation builds. Changed code may coincidentally reproduce outputs, while persisting every operational replay would accumulate derived state.

## Decision

- Every `SearchEnginePort` declares a content-bound `adapterBuildId`. The registry validates its format and uniqueness together with candidate and engine coordinates, and the CLI lists it.
- Release manifests must change the build ID whenever behavior or dependencies change. A declared ID does not prove module bytes, signatures, or supply-chain identity.
- Schema-v2 comparisons and reviews include the build ID in content IDs. Review, activation, refresh, and resolver operations compare stored and registry IDs before candidate calls. A missing or mismatched ID is `evaluation_candidate_build_mismatch`, with no fallback.
- New activation and refresh operations require v2 evidence. Read legacy v1 without inserting fields or recalculating IDs; it may validate existing legacy selections but cannot create a new review, activation, or refresh.
- Successful v2 replay deterministically derives `SearchCandidateVerificationReceipt` from project, candidate, engine, build, comparison, review, corpus, run, and index.
- Persist no receipt file, event, or Hub source. Search and status expose only a nullable receipt ID. It proves resolver replay at those coordinates, not query execution, use, or quality.

Receipts and build IDs exclude query and digest, paths, bodies, prompts, results, credentials, and reasoning. A malformed build is an invalid engine; tampered evidence or receipts use existing invalid-comparison or invalid-review semantics; the operational wrapper stops with selection unavailable.

## Consequences

Replay evidence is build-bound without accumulating another authoritative store or rewriting legacy sources.
