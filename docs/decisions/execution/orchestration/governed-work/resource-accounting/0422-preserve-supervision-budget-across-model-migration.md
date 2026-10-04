# ADR-0422: Preserve supervision budgets across explicit model migration

- Status: `accepted`
- Decision date: 2026-09-19

## Context

After a reviewed model-policy migration, an installed AXLI supervision workstream recorded 942,313 provider-reported Astra tokens and 64,942 provider-reported Sol tokens. Both observations share the Codex adapter version, primary-provider scope, cumulative-turn counter, normalization, native-counter semantics, and service tier; their exact accounting descriptors differ only in the explicitly requested model.

ADR-0400 proves only a default-versus-explicit descriptor pair for one observed model. After review raised the mandate ceiling from 1,000,000 to 2,000,000, that proof returned `usage_unobserved` and blocked work despite all 1,007,255 tokens being observed.

## Decision

Keep exact resource groups and descriptor-bound governed limits unchanged. For the separate supervision mandate's aggregate-token admission, derive a total from two or more complete, provider-reported, primary-provider groups only when:

- All descriptor bytes validate against their hashes and differ only in explicitly requested model.
- Every final observation covers one distinct causal run, reports a nonnegative safe-integer total, and proves one actual answer model equal to its explicit request using supported provider evidence.
- Group totals equal their constituent observations, every causal run is covered exactly once, and the combined sum remains a safe integer.

The ADR-0400 default-versus-explicit path remains limited to exactly two groups and one identical observed model. Do not infer comparability for a mixed default and multi-model population. Different providers, scopes, adapter versions, accounting modes, normalization, native-counter semantics, service tiers, unavailable or partial observations, aliases, missing runs, and duplicate observations remain unavailable.

## Consequences and verification

This is a derived admission calculation, not a new event, persisted state, normalization of provider costs, or claim that models share a price or tokenizer. All historical usage and unsettled reservations remain charged; mandate succession does not reset them. Failure remains `usage_unobserved`. No request body, credential, or prompt enters the proof.

Pure tests cover two- and three-model migration, exact totals, unchanged input groups, and existing negative evidence cases. Before supervision can report ready, the installed AXLI observation must show historical and new groups charged together under the reviewed 2,000,000-token ceiling.

## References

- [ADR-0400](../0400-prove-default-model-supervision-budget-comparability.md)
- [Managed resource accounting](../../../../../specifications/execution/resource-and-performance-budgets/managed-resource-accounting.md)
