# ADR-0054: Boundary between search recommendations and managed context selection

Status: `accepted`
Decision date: 2026-08-20

## Context

Injecting search results directly collapses `recommended`, `selected`, `loaded`, and `injected`. Ranking proposes candidates but cannot replace selection policy, current-source loading, or provider delivery. Yet managed runs need enough linkage to reconstruct which recommendation influenced selection.

## Decision

### Recommendation batch

- `SearchRecommendationBatch` binds an immutable attempt, recommendation maximum, and `top_ranked-v1` policy.
- v1 recommends up to five document hits and selects at most the top three. Exclude skills/verified knowledge until safe loaders exist.
- Each recommendation contains deterministic IDs, attempt/engine/index/result-set coordinates, document ID/search-time hash/rank/score—never query, terms, path/title/label/body.
- Validation recomputes attempt hash, order, policy, IDs, and selections; caller mutation invalidates the batch.

### Separate context states

- `@lervo/context` accepts at most eight batches/50 recommendations.
- Every recommendation creates E0 plus `recommended` evidence. Only policy-selected IDs create E1 with `reasonCode=search_recommendation` and rule `search_recommendation:<recommendationId>`.
- Unselected items never become required documents/E2/E3.
- Selected documents bind search-time hash. Any current-byte mismatch fails the entire context and requires a new search, even if another reason selected the same document.
- E2 and E3 still require actual source reads and adapter receipts; none implies understanding/use.

### Managed run

Before provider start, local `lervo run` projects the task deterministically into NFKC letter/number terms (32/500-character bounds); use expected path only if no term. Attempt digest/count describe this bounded projection, not full task. Record mode-`0600` attempt and pass its batch to context. Zero hits records an empty attempt and continues existing path/role/instruction selection.

Return attempt ID, recommendation/selection counts, and selected document IDs for optional explicit assessment. Never auto-assess from recommendation, selection, E2/E3, or run success.

`context.recommended` stores recommendation/batch/attempt, engine/index/result-set, document/hash/rank/score, and selection-policy coordinates. It excludes query/digest, path/title/label/body, prompt, response, and credentials. Attempts remain local; recommendation events follow ordinary event sync when configured. Selection/loading/injection remain separate events.

Invalid batch/context relationships produce no partial plan/event; selected hash mismatch prevents E2/E3/provider; corpus/attempt-storage failure prevents provider rather than disguising a searchless run.

## Consequences

Bounded lexical ranking is only a recommendation input. Role-specific policy, opt-out, additional source loaders, and semantic comparison await explicit assessment evidence.
