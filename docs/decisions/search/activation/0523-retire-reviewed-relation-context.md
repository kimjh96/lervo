# ADR-0523: Retire reviewed relation context

Status: `accepted`
Decision date: 2026-10-19
Amends: [ADR-0217](../0217-local-hybrid-search-and-reviewed-relation-context.md) (removes "Traverse reviewed relations after search")

## Context

ADR-0217 added a one-hop projection over human-reviewed relation sidecars. Knowledge query computed the projection on every call, and managed context could select up to two of its targets with the `graph_recommendation` reason.

The projection never received input. In this repository on 2026-10-19:

- `.lervo/knowledge/relations/` and `.lervo/knowledge/claims/` did not exist.
- None of the 1,732 `knowledge.materialization.applied` events recorded the `semantic` operation, the only path that writes relation sidecars.
- None of the 21,950 local events from 2026-08-24 to 2026-10-18 carried a relation projection or recommendation identifier.

Relation sidecars come only from a manual sequence: `lervo knowledge compile` with a provider, a reviewed policy file, `lervo knowledge review`, and `lervo knowledge materialize`. Background convergence does not run the semantic compiler. Nobody ran that sequence here, so the projection was always empty.

The empty projection still had a cost. Each query preparation read and hashed every concept and relation sidecar to bind the projection identity. Managed context, run summaries, preparation observations, and the linked-evidence shadow and canary all carried the empty list.

The closest measured mechanism did not help either. The [paired lexical-only comparison](../../../evidence/search/paired-uplift/lexical-linked-uplift-v1.md) tested deterministic one-hop linked context against `lexical-v1` in 32 Codex and Claude runs. Claim recall fell by 6.25 percentage points, and five task pairs lost quality while two won. [ADR-0302](provider-shadow-structured/typed-context/0302-retire-linked-default-and-use-search-engine-ports.md) retired that default. Reviewed relations differ from linked evidence, but nothing suggests they would reverse that result.

## Decision

Remove the reviewed relation projection from knowledge query and managed context.

- `KnowledgeQueryResult` no longer has `relationProjection`. Knowledge query no longer accepts a document registry or hashes concept and relation sidecar sets.
- `@lervo/context` no longer accepts graph recommendations. `GraphDocumentRecommendation` and `invalid_graph_recommendation` are removed.
- The managed run `searchContext` summary drops `recommendedGraphDocuments` and `selectedGraphDocuments`. `lervo knowledge query --json` drops `relationProjection`.
- The `graph_recommendation` selection reason stays in the event schema so stored `context.selected` events keep validating. No code path emits it.

This decision keeps the following:

- The semantic compile, review, and materialize commands, and relation sidecars with their lint and exchange contracts.
- The Hub's event-derived graph from [ADR-0052](../../knowledge/semantics/0052-rebuildable-explicit-knowledge-graph.md). It projects execution events for operator tracing and never fed managed context.

A future relation-based context mechanism must follow ADR-0302. It goes behind the search-engine port, runs a paired comparison against the current baseline on a corpus with reviewed relations, and activates only through the reviewed transition chain.

## Consequences

Knowledge query preparation no longer reads relation sidecars or hashes the concept and relation sidecar sets. Managed context loses a selection source that was never used, along with its validation branch.

Consumers of the two removed JSON fields must stop reading them. The fields only ever held an empty projection and zero counts, so no consumer could have relied on a non-empty value.

Removal claims nothing about relation quality. It records that the mechanism had no input and that a comparable mechanism showed no measured benefit.

## Verification

- Repository knowledge tests prove that prepared and one-shot queries return identical results for reviewed current concepts.
- Context, repository-context, conversation-responder, Node conversation context, and CLI managed-run, deliberation, linked-evidence canary, and product search tests pass without graph recommendations.
- The full type check passes. No source references the removed type, error code, or result field.
