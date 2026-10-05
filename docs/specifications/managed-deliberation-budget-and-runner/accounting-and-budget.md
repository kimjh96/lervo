# Usage accounting and budget

## Usage accounting

`observedRunTokens` parses resource usage events through the execution-contract reader. It accepts only records with the requested scope, status `observed`, and non-null usage. It groups accepted records by `resourceObservationId`, keeps each identity's maximum total, and sums those totals. With no accepted observations, it returns null, distinct from an observed zero-token total.

The controller queries events for the completed run ID. Its default scope is `deliberation`, but the runner explicitly supplies `resourceScopeForRelationship`'s result. Without a causal parent, the runner passes `root`; with a causal parent, it passes the requested work relationship, defaulting to `deliberation`. The execution contract owns the exact relationship-to-scope mapping; these two files do not establish it.

[ADR-0460](../../decisions/coordination/deliberation/0460-trigger-tiered-deliberation-at-decision-points.md) describes verification using usage status `complete`; this implementation tests `observed`. The supplied files do not establish equivalence at the schema boundary. Review that boundary before changing the ADR or treating this helper as proof of artifact usage verification. The helper does not independently match a provider or verify an artifact.

## Budget admission and failure

The controller can restore provider-call count, observed-token count, and start time. Admission rejects a negative or non-integer finalization reserve. It refuses admission when calls or observed tokens have reached their limits, or remaining elapsed time cannot cover the reserve. Successful admission increments the call counter and returns the remaining execution allowance after the reserve. This precedes verification preparation and adapter creation, so the counter alone does not prove provider invocation.

Completed-run observation adds the accepted token total. Missing observations fail with `deliberation_budget_observation_unavailable`; reaching the token or elapsed-time limit fails with `deliberation_budget_exhausted`. Observed accounting does not reserve tokens to prevent the current call from exceeding its token limit. Deduplication occurs within each observation calculation; the controller keeps no separate set of already-accounted run IDs.
