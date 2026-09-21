# ADR-0422: Preserve supervision budgets across explicit model migration

- Status: `accepted`
- Decision date: 2026-09-19

## Context

An installed AXLI supervision workstream recorded 942,313 provider-reported Astra tokens and 64,942 provider-reported Sol tokens after its reviewed model-policy migration. Both observations use the same Codex adapter version, primary-provider scope, cumulative-turn counter, normalization, native-counter semantics, and service tier; their exact accounting descriptors differ only in the explicitly requested model. ADR-0400 proves only a default-versus-explicit descriptor pair for one observed model. After the mandate ceiling was reviewed from 1,000,000 to 2,000,000, the old proof therefore returned `usage_unobserved` and blocked work even though all 1,007,255 tokens were observed.

## Decision

Keep exact resource groups and descriptor-bound governed limits unchanged. For the separate supervision mandate's aggregate-token admission, derive a total from two or more complete, provider-reported, primary-provider groups when all descriptor bytes validate against their hashes and differ only in explicitly requested model. Every final observation must cover one distinct causal run, report a nonnegative safe-integer total, and prove one actual answer model equal to its explicit request with supported provider evidence. Group totals must equal their constituent observations, all causal runs must be covered exactly once, and the combined sum must remain a safe integer.

The existing ADR-0400 default-versus-explicit path remains limited to exactly two groups and one identical observed model. A mixed default and multi-model population is not inferred comparable. Different providers, scopes, adapter versions, accounting modes, normalization, native-counter semantics, service tiers, unavailable or partial observations, aliases, missing runs, and duplicate observations remain unavailable.

## Consequences and verification

This is a derived admission calculation, not a new event, persisted state, normalization of provider costs, or claim that different models have the same price or tokenizer. All historical usage and unsettled reservations remain charged; mandate succession does not reset them. Failure remains `usage_unobserved`. No request body, credential, or prompt enters the proof.

Pure tests cover two- and three-model migration, exact totals, unchanged input groups, and existing negative evidence cases. The installed AXLI observation must show the historical and new groups charged together under the reviewed 2,000,000-token ceiling before supervision can report ready.

## References

- [ADR-0400](../0400-prove-default-model-supervision-budget-comparability.md)
- [Managed resource accounting](../../../../../specifications/execution/resource-and-performance-budgets/managed-resource-accounting.md)
