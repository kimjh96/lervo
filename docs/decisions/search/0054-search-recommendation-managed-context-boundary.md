# ADR-0054: Boundary between search recommendations and managed context selection

- Status: `accepted`
- Decision date: 2026-08-20

## Context

Injecting search results directly collapses `recommended`, `selected`, `loaded`, and `injected`. Ranking can propose candidates but cannot replace selection policy, current-source loading, or provider delivery. Managed runs still need enough linkage to reconstruct which recommendation influenced selection.

## Decision

### Recommendation batch

- `SearchRecommendationBatch` binds an immutable attempt, recommendation maximum, and `top_ranked-v1` policy.
- v1 recommends at most five document hits and selects at most the top three. Skills and verified knowledge are excluded until safe loaders exist.
- Each recommendation contains deterministic IDs, attempt/engine/index/result-set coordinates, and document ID/search-time hash/rank/score—never query, terms, path/title/label/body.
- Validation recomputes the attempt hash, order, policy, IDs, and selections. Caller mutation invalidates the batch.

### Separate context states

- `@lervo/context` accepts at most eight batches and 50 recommendations.
- Every recommendation creates E0 plus `recommended` evidence. Only policy-selected IDs create E1 with `reasonCode=search_recommendation` and rule `search_recommendation:<recommendationId>`.
- Unselected items never become required documents or E2/E3.
- Selected documents bind their search-time hash. Any current-byte mismatch fails the entire context and requires a new search, even when another reason selected the same document.
- E2 and E3 still require actual source reads and adapter receipts; neither implies understanding or use.

### Managed run

Before provider start, local `lervo run` deterministically projects the task into NFKC letter/number terms, bounded to 32 terms and 500 characters; it uses the expected path only when there is no term. Attempt digest/count describe this bounded projection, not the full task. It records mode-`0600` attempts for operational search and repository-knowledge search and passes their batches to context. Zero hits records an empty attempt and continues the existing path/role/instruction selection.

Repository-knowledge hits load only current, bounded repository bytes and carry source snapshot, impact report, concept, assurance, and freshness coordinates. A hit whose path is already a registered document reuses that document ID. A hit for a dynamically discovered AGENTS instruction reuses the deterministic path ID assigned by instruction discovery. The canonical candidate must carry the knowledge metadata consistently through E0, recommendation, E1, E2, and E3; unrelated candidates that merely share a path or ID fail closed.

The run returns attempt ID, recommendation/selection counts, and selected document IDs for optional explicit assessment. Recommendation, selection, E2/E3, and run success never create automatic assessments.

`context.recommended` stores recommendation/batch/attempt, engine/index/result-set, document/hash/rank/score, and selection-policy coordinates. It excludes query/digest, path/title/label/body, prompt, response, and credentials. Attempts remain local; recommendation events use ordinary event sync when configured. Selection, loading, and injection remain separate events.

Invalid batch/context relationships produce no partial plan or event. A selected-hash mismatch prevents E2, E3, and provider start. Corpus or attempt-storage failure prevents provider start instead of disguising a searchless run.

## Consequences

Bounded lexical ranking is only a recommendation input. Registry, instruction, and repository-knowledge views of one exact path converge on one canonical candidate without weakening duplicate-path rejection. Role-specific policy, opt-out, additional source loaders, and semantic comparison await explicit assessment evidence.
