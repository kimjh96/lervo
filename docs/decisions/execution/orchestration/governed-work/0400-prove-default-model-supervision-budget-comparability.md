# ADR-0400: Prove default-model supervision budget comparability

- Status: `accepted`
- Decision date: 2026-09-13

## Context

Outcome supervision can request an explicit model for owner reasoning while a managed worker uses the provider default. Final observations may prove the same actual model and counter semantics while their exact accounting descriptors differ in `requestedModel`. A successful worker then leaves aggregate supervision admission unavailable before independent review.

## Decision

Preserve the exact reporting groups and descriptor-bound governed token limits from ADR-0334, ADR-0354, and ADR-0373. Add one narrow, derived total-token comparability proof for supervision mandate admission. The proof does not merge reporting groups or change canonical observations.

The proof accepts exactly two complete, provider-reported, primary-provider groups that cover every causal run exactly once. Provider, accounting mode, adapter identity and version, normalization, native-counter semantics, observation support, and service tier must agree. Exact CAS descriptor bytes must validate against their hashes. The descriptors may differ only because one requested model is null and the other is explicit.

Every final usage observation must identify exactly one actual answer model with supported provider evidence. All actual models must agree, and the explicit request must equal the observed model without alias inference. Replacing only the null requested model in a derived descriptor must produce the same canonical descriptor hash. Verified per-run totals must match each original group total, and the combined total must be a nonnegative safe integer. Missing, duplicate, partial, contradictory, mixed-model, cross-provider, or cross-scope evidence remains unavailable.

`@lervo/work-controller` owns the pure proof. The Node resource observer supplies exact, bounded CAS descriptors through its existing artifact port. Source event hashes and referenced descriptor hashes remain bound by the existing task digest and fenced source recheck. The proof introduces no provider-specific branch, network call, new cache, or synthetic usage event.

## Consequences, authority, privacy, and failure meaning

This is a rebuildable admission calculation, not a new event or persistent state. Its inputs are existing causal run IDs, exact groups, final usage events, and descriptors. Its result is a total or unavailable. Existing `usage_unobserved` and resource-admission failure meanings remain unchanged. Reports retain their original separate groups.

Prompts, result bodies, credentials, prices, and billing claims are outside the proof. All historical usage and unsettled reservations remain charged. Mandate succession cannot reset usage, and the configured aggregate ceiling remains unchanged. A compatible total proves neither independent artifact acceptance nor goal completion.

## Verification

Cover default-versus-explicit success without input mutation; missing runs and descriptors; duplicate observations; total mismatch and overflow; differences in provider, scope, mode, normalization, counter, adapter version, and service tier; and missing, mixed, aliased, or different actual models. Recheck the installed successful worker result without dispatching it again, then require independent semantic acceptance through the existing supervision contract.

## References

- [Canonical admission](../../../../specifications/execution/outcome-supervision/implementation/managed-execution/task-observation/admission-and-readiness/admission.md)
- [Managed resource accounting](../../../../specifications/execution/resource-and-performance-budgets/managed-resource-accounting.md)
- [ADR-0373](0373-enforce-managed-execution-dimension-and-duration-budgets.md)
- [ADR-0354](../../../operations/trace/0354-enforce-scope-complete-resource-and-terminal-budgets.md)
