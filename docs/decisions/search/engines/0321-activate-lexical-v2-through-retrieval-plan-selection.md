# ADR-0321: Activate lexical-v2 through retrieval-plan selection

Status: `accepted`
Date: 2026-08-31

## Context

ADR-0320 qualified provider projection, lexical-v2 retrieval, and deterministic fusion, but rejected an engine-only transition because it omitted measured stages. The existing engine chain remains correct for one deterministic `SearchEnginePort`; replacing it would weaken compatibility and external-engine boundaries. Operational terminal retrieval therefore needs complete-plan selection above that port.

## Decision

Add a bounded `SearchRetrievalPlan` contract and an independent immutable activation chain. A plan binds:

- At least two named projector populations, with exact builds and limits.
- One registered retriever candidate and adapter build.
- The fusion algorithm, per-query and final bounds, fail-closed behavior, and privacy exclusions.

External-only, augmentation, and reranking are distinct plan identities. This first contract activates only the local projected lexical-v2 plan and grants no network, credential, export, retention, or cost authority.

One tracked `SearchRetrievalPlanActivationBundle` content-binds the plan, review, and policy. The review binds the current corpus snapshot, digest, document and byte counts, unchanged reviewed suite, repetitions, complete passing observations for at least two provider populations, complete usage, zero projection failures, duration compliance, and exact engine-efficiency evidence. The policy allowlists plan, reviewer, operator, and project coordinates. Changed content receives new IDs and cannot satisfy an existing transition.

`SearchRetrievalPlanActivation` is local immutable state containing required project, sequence, predecessor, action, policy, operator, time, selected plan/review/bundle coordinates, and rollback target. The first candidate transition points to the local baseline. Rollback appends a successor selecting that baseline; it never edits or deletes the candidate transition. Competing successors from one predecessor conflict.

Runtime resolution revalidates the complete transition chain and tracked bundle. Before retrieval, it rebuilds the registered Markdown corpus from the current repository-knowledge scan and requires the exact reviewed path-and-content digest, count, and byte total. The review retains the source-scan snapshot as the evidence coordinate, but runtime corpus equivalence does not compare that broader coordinate because unrelated workstream and activation observations may advance it without changing the Markdown corpus. Runtime also requires the selected provider population's current projector identity and build, registered engine identity and adapter build, and plan limits. It executes every projected query independently through the selected `SearchEnginePort`, validates every response, applies the selected deterministic fusion, and maps final paths to current concept coordinates before loading.

Any required projection, corpus, retriever, response, fusion, registration, or evidence mismatch is `retrieval_plan_selection_unavailable` and fails terminal preparation closed. While a candidate plan is selected, there is no raw-query, lexical-v2-only, lexical-v1, stale-index, or partial-stage fallback. Explicit rollback restores the independent baseline path.

The activation bundle and transition exclude request text, context text, projected queries, source bodies, native scores, prompts, responses, credentials, and provider output. Report hashes and privacy-bounded receipt IDs prove only bound observations. Retrieved sources remain `selected`; loading, injection, reference, correctness, and provider use require their existing evidence stages.

## Activation conditions

Activation requires fresh five-repetition Codex and Claude reports using the same current corpus and unchanged four-case suite. All 40 lexical-v2 observations must pass, every projection must record usage, projection failures must be zero, and projection must remain within 20 seconds. ADR-0308 v20 evidence continues to provide the unchanged complete-pipeline quality and efficiency gates. The checked-in bundle is the reviewed activation coordinate; the local transition is the operational selection.

After activation, verify one real terminal retrieval through the selected plan, append an explicit rollback transition, verify baseline readiness, reactivate the unchanged bundle, and verify selected-plan readiness again. This rehearsal establishes mechanism and current availability, not unattended rollout safety or semantic provider use.

## Consequences

Lexical-v2 can become the effective operational terminal retriever without representing dynamic projection as one deterministic engine. The compatibility engine-selection chain remains available to single-engine clients. Third-party adapters may later use the same plan identity and review boundary without importing vendor SDKs into core search, but require installation locks, external authority, and separate evidence.

## Verification

- Pure plan, review, policy, bundle, activation, tamper, and rollback tests.
- File-backed activation, transition-conflict, resolution, and explicit rollback tests.
- Terminal tests covering selected build, provider population, current corpus, stage failure, and absence of fallback.
- Fresh Codex and Claude five-repetition reviewed-suite reports over one current corpus.
- Operational status, selected-plan terminal retrieval, rollback readiness, reactivation, quality, documentation lifecycle, knowledge lint, and release-completion checks.

## References

- [Plan qualification](0320-qualify-projected-lexical-v2-without-engine-activation.md)
- [Replacement and composition](0306-separate-search-engine-replacement-and-composition.md)
- [Activation gates](0308-pre-register-lexical-v2-pipeline-activation-gates.md)
- [V20 engine evidence](../../../evidence/search/lexical-v2/lexical-v2-activation-confirmation-v20.md)
- [Reviewed real-use suite](../../../../benchmarks/search/lexical-v2-real-use-reviewed-v1.json)
