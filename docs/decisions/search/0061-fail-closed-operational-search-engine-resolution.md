# ADR-0061: Fail-closed operational search-engine resolution

Status: `accepted`
Decision date: 2026-08-20

Partially superseded by [ADR-0560](../foundation/0560-remove-unused-subsystems-to-harden-the-core.md): the selection chain part is removed. The resolver no longer reads or revalidates engine selection transitions, policies, reviews, or comparisons, and `selectionTransitionId` is always null. `SearchEnginePort`, `SearchIndexPort`, the shared `@lervo/search-local` resolver, and fail-closed `engine_selection_unavailable` stay.

## Context

Recorded selections have no effect until ordinary search and context operations consume them. Connecting candidates without revalidation could silently fall back after missing adapters, changed corpora, or tampered evidence while appearing to use the candidate. The evaluation baseline must remain independently fixed, and an explicit baseline rollback must work without replaying an unavailable historical candidate.

## Decision

- Generalize evaluation ports as provider-neutral `SearchEnginePort` and `SearchIndexPort`, retaining compatibility aliases. Operational code resolves candidate IDs through a narrow registry port.
- Search, managed context, and status share one `@lervo/search-local` resolver and inspection boundary.
- Without a transition, build the current `lexical-v1`. With a chain, revalidate every transition against policy, review, comparison, content, and project coordinates.
- For a candidate head, revalidate the current registry, corpus, comparison, and review replay, and require the candidate index ID bound by the comparison.
- For a baseline head, build the current lexical corpus without replaying historical candidates. Explicit rollback therefore remains usable after candidate removal or corpus change.
- The evaluation and comparison baseline bypasses the operational resolver and remains lexical.
- Any selected-chain, policy, review, comparison, registry, corpus, replay, index, or response failure returns `engine_selection_unavailable`. Never fall back, create an attempt or recommendation, or start a provider.
- `SearchAttempt` records the actual engine and nullable `selectionTransitionId`. A candidate requires the ID; implicit baseline uses null; rollback baseline records the rollback transition. Recommendations and events carry the same ID without implying later context or use.
- New transitions use schema v2 with `recordState=selection_recorded`; v3 rollback adds ADR-0068 evidence. Preserve legacy v1 IDs and files without rewriting.
- Status distinguishes recorded selection from resolver-verified `ready` or controlled `unavailable`; neither means a query ran.

Add no event or source kind. Attempts remain local, and recommendation privacy is unchanged. Historical events without a transition ID remain byte-identical; only new writers require it.

## Consequences

Operational engine use is explicit and fail-closed, while evaluation retains a stable lexical baseline and rollback can independently restore baseline operation.
