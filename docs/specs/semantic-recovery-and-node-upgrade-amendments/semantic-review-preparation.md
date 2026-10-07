# Semantic review preparation

[ADR-0490](../../decisions/knowledge/semantics/0490-regenerate-stale-semantic-candidates-before-the-pre-stage-check.md) supplies the ordering that [ADR-0486](../../decisions/knowledge/semantics/0486-regenerate-stale-semantic-candidates-and-reuse-repository-observation.md) left unverified in its evidence limits.

## Execution contract

The provider-neutral owner calls optional `prepareStage(stage, input)` before its pre-stage currency check. A non-null result settles the stage without running it. Otherwise, the owner performs the check and calls `runStage`. Post-stage input and currency checks apply to both paths.

The runtime uses preparation for ADR-0486's bounded regeneration: stale bound context on a canonical or normalization review returns that review to its producing stage, at most three times per obligation. Other source drift still fails the pre-stage check. Regeneration retains the `review_context_regenerated` receipt and introduces no event, state, or failure code.

## Evidence and acceptance

The triggering observation was digimon's 03:20:16 UTC requeue on 2026-10-07 under runtime `41465145`. It settled again with `review_context_stale` after 0.18 seconds, without an assignment, evidence hash, or regeneration count. Regeneration inside `runStage` was unreachable because `host.assertCurrent(state)` failed first.

Required verification covers:

- An owner-level regression that fails under the previous ordering.
- Preparation returning null for current context.
- Stale-context regeneration.
- Rejection of stale state followed by acceptance of regenerated state.

Digimon leaving the installed stall remains required evidence; the supplied source does not report that success.
