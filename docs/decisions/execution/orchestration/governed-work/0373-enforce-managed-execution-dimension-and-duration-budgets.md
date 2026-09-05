# ADR-0373: Enforce exact managed execution dimension and duration budgets

- Status: `accepted`
- Decision date: 2026-09-05

## Context

GLA5 admitted the next governed attempt only when an exact provider, resource-scope, and accounting-descriptor total-token observation remained below its configured threshold. Managed execution already recorded normalized input, cached-input, output, reasoning-output, and total tokens and a complete stage-duration tree, but governed policy ignored individual dimensions and duration. The CLI and operating client independently recalculated token budget presentation.

Provider-specific controller counters, summed child elapsed durations, and estimated request-wide totals would violate provider neutrality and evidence meaning. Replacing the total-token option or JSON fields would change the product-host version 1 contract in place.

## Decision

Preserve `tokenLimits` and `--token-limit` for total tokens. Add `tokenMetricLimits` and `--token-metric-limit` for exact `input_tokens`, `cached_input_tokens`, `output_tokens`, or `reasoning_output_tokens` observations. Both forms bind provider, optional compatibility scope, accounting-descriptor hash, and an inclusive positive threshold. An unscoped limit must match exactly one group; ambiguity is unobservable.

Add `durationLimits` and `--duration-limit`, binding exact provider, resource scope, managed stage ID, and an inclusive positive millisecond threshold. Assess the largest exact per-run observation in the matching population. Never sum sequential, concurrent, cross-profile, or child-run elapsed durations into a synthetic request duration. Resource dimensions retain their normalized provider accounting descriptor and are summed only within its existing exact group.

`@lervo/application-contract` owns the additive policy, observation, and assessment shapes. `@lervo/work-controller` separately owns resource projection, stage projection, pure budget assessment, and governed admission. Governed-work reports contain authoritative assessments; the CLI and `@lervo/operating-client` render them without recalculation. Provider adapters own native usage translation and share the existing adapter contract. Policy code contains no provider branches.

Configured budgets fail closed at two boundaries:

1. Before another attempt, an exact reached threshold yields `token_budget_exhausted` or `duration_budget_exhausted`. Absent, partial, invalid, unavailable, or ambiguous evidence yields `budget_observation_unavailable`.
2. After a provider run passes verification and writing publication, the CLI reprojects the same governed policy before successful assignment finalization. A reached or unobservable configured budget finalizes the assignment as failed with the exact reason.

Limits neither reserve future resources nor prove that an in-flight provider call can be preempted. Existing adapter deadlines remain the runtime termination authority. Thresholds are observed admission and acceptance boundaries for managed work, not evidence of billing, cost, quality, or task correctness.

## Assessment state, privacy, and failure meaning

`ManagedExecutionBudgetAssessmentV1` is a rebuildable application projection, not a new event. Every assessment requires schema version, kind, provider, scope, evidence completeness, threshold state, exact limit, and observed and remaining values. Token assessments also require accounting-descriptor hash and metric. Duration assessments also require managed stage ID, observation count, and maximum observed duration.

`thresholdState` means:

- `below`: one complete exact observation population remains below the inclusive limit.
- `reached`: the exact observed value equals or exceeds the limit.
- `unknown`: the required exact population is absent, ambiguous, partial, unavailable, or invalid.

Reports retain opaque providers, scopes, descriptor hashes, stage IDs, durations, normalized counters, completeness, thresholds, and reason codes. They exclude prompts, outputs, paths, credentials, native responses, prices, invoices, and provider errors. Report cached-input tokens only when the adapter supplies the normalized counter. Never infer cache state, savings, price, or billed cost.

## Consequences

Operators can inspect and enforce total, input, cached-input, output, reasoning-output, and per-run stage-duration budgets through one provider-neutral policy. Missing telemetry and inclusive exhaustion close both next-attempt and successful-finalization paths. Existing total-token CLI syntax and token budget JSON fields remain readable.

Direct terminal work remains unmanaged. Query-projection counters remain per context, direct provider whole-task usage remains unsupported, and monetary budgets remain unavailable without exact accounting and price coordinates.

## References

- [Resource and performance budgets](../../../../specifications/execution/resource-and-performance-budgets.md)
- [Execution stage observation](../../../../specifications/execution/stage-observation-and-performance.md)
- [ADR-0341](0341-project-current-objective-and-observed-token-budgets.md)
- [ADR-0354](../../../operations/trace/0354-enforce-scope-complete-resource-and-terminal-budgets.md)
- [Managed execution resource budget evidence](../../../../evidence/foundation/managed-execution-resource-budgets-v1.md)
