# ADR-0302: Retire the linked default and use search-engine ports

Status: `accepted`; supersedes the production activation in ADR-0301
Date: 2026-08-30
Amended by: [ADR-0528](../../0528-remove-the-linked-evidence-canary-and-shadow.md) (the retained canary and shadow are removed)

## Context

ADR-0301 activated deterministic one-hop linked supporting context after a fresh canary passed delivery-oriented recall and precision gates. That population lacked a lexical-only control.

A later paired evaluation held source, task, provider, model, role, verification, and scoring inputs constant across 32 Codex and Claude runs. Linked context preserved expected-source recall but reduced equal-provider mean claim recall and complete-answer rate by 6.25 percentage points each. It reduced mean duration by 9.89% and Codex-reported tokens by 7.02%, but increased Claude-reported tokens by 28.33%. Five task pairs lost quality, two won, and nine tied. The current source worktree also had no registered search documents, making its ordinary linked projection empty.

Lervo already provides a provider-neutral replacement boundary: `SearchEnginePort`, `SearchIndexPort`, a bounded candidate registry, build-bound comparison and review, immutable activation transitions, and fail-closed operational resolution. Another post-search context mechanism would bypass that evidence chain instead of improving retrieval through the existing contract.

## Decision

Retire `managed-linked-evidence-default-v1`. Ordinary managed Codex and Claude runs no longer project, select, load, or inject linked-only sources. Without a verified candidate-engine transition, operational retrieval uses the `lexical-v1` baseline and its ordinary top-ranked recommendation path.

Keep the exact-authorized linked canary default-off, retaining its contracts, tests, records, and v1-v18 evidence as historical experiment infrastructure. The public CLI exposes no canary authorization input. A dependency-injected evaluation executor may reproduce the paired treatment, but no default application composition supplies it. These retained paths do not authorize ordinary linked context.

Use the existing search-engine boundary for future retrieval improvements:

1. Implement `lexical-v2` or another local engine as a `SearchEnginePort` with a distinct engine identity and content-bound `adapterBuildId`.
2. Implement any external engine behind the same port in an adapter package. Core search, context, and provider orchestration must not import a vendor SDK or depend on Codex or Claude behavior.
3. Register no more than the existing bounded candidate limit. Registration alone has no operational effect.
4. Compare the candidate with the fixed `lexical-v1` evaluation baseline on the same corpus and cases, then require reviewed quality, latency, privacy, and cost evidence.
5. Activate only through the existing immutable policy-bound transition. At runtime, revalidate the adapter build, corpus, comparison, review, index, and response. Any failure is `engine_selection_unavailable`; never silently mix engines or fall back.
6. Preserve explicit rollback to `lexical-v1`. Local baseline execution remains available without a Hub, external credential, or network service.

The engine port owns only indexing and ranking. Corpus acquisition, query grounding, context selection, and provider delivery remain separate contracts. A future reranker, query-expansion stage, remote corpus, or context-expansion mechanism requires its own measured variation and observable boundary; it must not be hidden inside an engine adapter to bypass review.

An external adapter may require separately authorized runtime credentials and network capability. Secret bytes remain runtime-only. Canonical attempts retain bounded engine and result coordinates, not queries, source bodies, credentials, or vendor responses. External unavailability fails the selected engine closed until an explicit reviewed rollback.

## Consequences

The production path returns to the measured lexical-only control. The linked experiment remains auditable but inactive. Retrieval work can replace the engine without provider branches or post-search context exceptions, while applying the same comparison, activation, observation, and rollback evidence to local and external candidates.

This decision does not claim that `lexical-v1` is optimal or that removal improves latency. It states only that the measured linked default lacks a no-quality-regression basis and that future improvement belongs behind the existing engine contract.

## Verification

- Common Codex and Claude managed-run tests require no linked-only E1, E2, or E3 evidence during ordinary execution and exactly one task-adapter creation.
- Exact-authorized canary tests remain default-off and pass unchanged evidence and failure contracts.
- Engine-port, registry, candidate replay, activation, operational resolution, and rollback suites pass.
- Quality, full repository, release-completion, knowledge migration, and knowledge lint checks pass.

## References

- [Paired lexical-only comparison](../../../../../evidence/search/paired-uplift/lexical-linked-uplift-v1.md)
- [Superseded linked activation](0301-activate-deterministic-claim-eligible-linked-context.md)
- [Operational engine resolution](../../../0061-fail-closed-operational-search-engine-resolution.md)
- [Adapter build identity](../../../0063-search-adapter-build-identity-and-replay-receipt.md)
- [System architecture](../../../../../architecture/system.md)
