# Managed deliberation budget and runner behavior

This document records the behavior visible in `apps/cli/src/managed-deliberation-budget.ts` and `apps/cli/src/managed-deliberation-runner.ts`. It supplements [ADR-0418](../decisions/execution/applications/0418-retain-deliberation-as-bounded-decision-workflow.md) and identifies an accounting terminology difference from [ADR-0460](../decisions/coordination/deliberation/0460-trigger-tiered-deliberation-at-decision-points.md). Source inspection does not establish passing tests or installed acceptance.

## Usage accounting

`observedRunTokens` parses resource usage events through the execution-contract reader. It accepts only records whose scope equals the requested scope, whose status is `observed`, and whose usage is non-null. It groups accepted records by `resourceObservationId`, retains the maximum total for each identity, and sums those totals. No accepted observation returns null, distinct from an observed zero-token total.

The controller queries events for the completed run ID. Its default scope is `deliberation`, but the runner explicitly supplies the result of `resourceScopeForRelationship`. Without a causal parent, the runner passes `root`; with a causal parent, it passes the requested work relationship or defaults to `deliberation`. The exact relationship-to-scope mapping belongs to the execution contract and is not established by these two files.

ADR-0460 describes verification using usage status `complete`; this implementation tests `observed`. The supplied files do not establish whether the terms are equivalent at the schema boundary. Review that boundary before changing the ADR or treating this accounting helper as proof of artifact usage verification. This helper does not independently match a provider or verify an artifact.

## Budget admission and failure

The controller can restore provider-call count, observed-token count, and start time. Admission rejects a negative or non-integer finalization reserve. It refuses admission when calls or observed tokens have reached their limits, or remaining elapsed time cannot cover the reserve. Successful admission increments the call counter and returns the remaining execution allowance after the reserve. This occurs before verification preparation and adapter creation, so the counter alone does not prove a provider was invoked.

Completed-run observation adds the accepted token total. Missing observations fail with `deliberation_budget_observation_unavailable`; reaching the token or elapsed-time limit fails with `deliberation_budget_exhausted`. This is observed accounting, not a reservation that prevents the current call from exceeding its token limit. Deduplication occurs within each observation calculation; the controller does not keep a separate set of already-accounted run IDs.

## Runner boundaries

One cached repository-snapshot capture is shared by the runner's executions, including semantic evaluations. The default finalization reserve is 50,000 ms. After preparation and coordinator construction, an abort timer uses the admitted allowance; a caught failure after that timer fires is translated to an elapsed-budget error, and the timer is always cleared.

Optional verification preparation selects the requested suite. Non-evaluation roles gain the `deliberation.task-evidence` requirement. An accepted participant binding must match the selected provider; participant model and reasoning settings take precedence over provider defaults. The coordinator permits zero tool calls and zero command executions. These limits describe configuration, not observed provider compliance.

Human-facing roles receive the workspace writing policy; machine-facing roles do not. When a causal parent exists, work causality records the relationship, parent coordinates, optional attempt ordinal, and bound agent identity. After usage accounting succeeds, result bytes are loaded from CAS, decoded as strict UTF-8, and checked against the declared byte count and content hash before returning content.

## Semantic evaluation recovery

Semantic evaluation permits at most two attempts. A second attempt requires `ManagedProviderRunError` with one of: `provider_start_failed`, `provider_stream_failed`, `provider_turn_failed`, `provider_model_unavailable`, `provider_result_failed`, or `repository_snapshot_failed`. Other failures propagate without retry.

Each attempt uses the normal runner and budget, with relationship `publication_evaluation`, its attempt ordinal, and the requested structured-output schema. The evaluation request is materialized as a workspace document, and the response passes through the semantic evaluation parser. This recovery retries the evaluator, not the writer, and does not establish successful publication or convergence.
