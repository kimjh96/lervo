# ADR-0364: Bind declarations to knowledge evidence and separate hook build cohorts

Status: `accepted`  
Date: 2026-09-04

## Context

Direct terminal declarations accepted `knowledgeDisposition=current` or `refreshed` without running the repository knowledge lifecycle. The Stop hook then repeated a complete knowledge scan even when a missing declaration or cheap prerequisite had already made the turn non-current. Real Codex observations measured Stop lifecycle inspection at 16,446.024 milliseconds p95 against a 5,000 millisecond budget.

Prompt preparation scanned the configured knowledge corpus separately for the instruction catalog and product-default search. Repository snapshotting unnecessarily waited for independent provider query projection. Historical and changed hook implementations also shared an environment-profile digest, allowing reports to mix incompatible performance cohorts.

## Decision

- Before recording the agent-authored event, a changed root turn declaration runs the repository knowledge lifecycle. Reject `current` and `refreshed` when current lifecycle issues exist. Keep `pending_user_approval` as an explicit non-success disposition.
- Store the exact-revision lifecycle result only in the existing rebuildable local cache. It adds no event claim and does not make a model proposal canonical.
- Stop first checks cheap workstream, declaration, deliberation, terminal-runtime, and workspace prerequisites. Root Stop skips the expensive repository knowledge scan when the turn is unchanged, already non-current, or explicitly pending user authority.
- A supported changed declaration may reuse only a cache matching the exact CLI version, repository revision, and supplemental source. An absent or mismatched cache requires a full scan.
- Within one read-only prompt-preparation operation, create one configured knowledge scan and pass it to the instruction-catalog and product-search responsibilities. Run provider projection and repository snapshot concurrently. Keep search selection, exact loading, projection, and lifecycle validation in separate modules.
- Give the hook environment profile a hook-build digest distinct from the unchanged event-policy digest. Every implementation that changes measured hook work requires a new build digest, preserving old failures without combining them with the current population.

## Evidence and limits

The first operational Codex observation for the new build completed Prompt in 8,997.680 milliseconds and Stop in 1,688.288 milliseconds. Query projection remained the dominant Prompt stage at 6,273.636 milliseconds and reported 11,846 tokens.

This single observation is diagnostic only. It is not a p50, p95, passing population, whole-task token count, billing claim, provider acceptance, or semantic-use claim.

The default budget remains unsuccessful until a new build cohort reaches the required population and passes unchanged limits. Retain historical exhausted cohorts. Direct provider whole-task usage remains unsupported because the installed hook payload does not expose usage for the main provider turn. The separate managed Codex app-server adapter observes provider-turn usage, but Lervo must not join that stream to an unmanaged hook turn without an explicit shared execution contract.

## Verification

- Terminal integration tests reject an unsupported `current` declaration, retain explicit pending authority, and prove unchanged Stop does not create a lifecycle cache.
- Lifecycle cache tests retain exact-coordinate and privacy checks.
- A new real observation retains separate stage and query-projection usage evidence.
- Before release, require the paired provider-free performance report, packed CLI, knowledge lifecycle, and release completion checks.

## Consequences

Declarations become evidence-bound, unnecessary Stop scans are avoided, prompt work is shared or concurrent where valid, and performance reports retain compatible hook-build cohorts. These changes do not expand the evidence claims or relax the default budget.

## References

- [Resource and performance budgets](../../../../specifications/execution/resource-and-performance-budgets.md)
- [Stage observation and performance](../../../../specifications/execution/stage-observation-and-performance.md)
- [Direct query projection](0353-remove-redundant-terminal-query-admission.md)
