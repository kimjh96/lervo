# ADR-0061: Fail-closed operational search-engine resolution

Status: `accepted`
Decision date: 2026-08-20

## Context

Recorded selections have no operational effect until ordinary search/context consume them. Connecting candidates without revalidation could silently fall back after missing adapters, changed corpus, or tampered evidence and still appear to have used the candidate. Evaluation baseline must remain fixed independently, while an explicit baseline rollback must recover without replaying an unavailable old candidate.

## Decision

- Generalize evaluation ports as provider-neutral `SearchEnginePort`/`SearchIndexPort`, retaining compatibility aliases. Operational code resolves candidate IDs through a narrow registry port.
- Search, managed context, and status share one `@lervo/search-local` resolver/inspection boundary.
- With no transition, build current `lexical-v1`. With a chain, revalidate every transition against policy/review/comparison/content/project coordinates.
- For candidate head, revalidate current registry, corpus, comparison, review replay, and require the candidate index ID bound by comparison.
- For baseline head, build current lexical corpus without replaying historical candidates. Thus explicit rollback remains usable after candidate removal/corpus change.
- Evaluation/comparison baseline bypasses operational resolver and stays lexical.
- Any selected-chain/policy/review/comparison/registry/corpus/replay/index/response failure returns `engine_selection_unavailable`; never fallback, create attempt/recommendation, or start provider.
- `SearchAttempt` records actual engine plus nullable `selectionTransitionId`. Candidate requires it; implicit baseline is null; rollback baseline records rollback transition. Recommendation/event carries the same ID without implying later context/use.
- New transitions use schema v2 `recordState=selection_recorded`; v3 rollback adds ADR-0068 evidence. Preserve legacy v1 IDs/files without rewriting.
- Status distinguishes recorded selection from resolver-verified `ready` or controlled `unavailable`; neither means a query ran.

Add no event/source kind. Attempts stay local and recommendation privacy stays unchanged. Historical events without transition ID remain byte-identical; only new writers require it.

## Consequences

Operational engine use is explicit and fail-closed, while evaluation remains a stable lexical baseline and rollback can restore baseline independently.
