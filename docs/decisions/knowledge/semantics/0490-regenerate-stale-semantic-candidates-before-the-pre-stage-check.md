# ADR-0490: Regenerate stale semantic candidates before the pre-stage check

Status: `accepted`
Decision date: 2026-10-07
Amends: [ADR-0486](0486-regenerate-stale-semantic-candidates-and-reuse-repository-observation.md)

## Context

`main` `f4185055` (ADR-0486) was deployed on the WSL host on 2026-10-07, after which `digimon`'s Node ran runtime `41465145`. At 03:20:16 UTC, `digimon` requeued its settled `canonical_review` once, as ADR-0485 intends after deployment. Within 0.18 s, the stage settled again as `attention_required/review_context_stale`, with no evidence hash or assignment. The batch's `reviewContextRegenerations` remained unset.

The owner calls `host.assertCurrent(state)` before `host.runStage`. ADR-0486 regenerated stale reviews only inside `runStage`, but the pre-stage check applied the same bound-context fence and threw `review_context_stale` before regeneration could run. ADR-0486's tests called `runStage` directly, missing the owner's call order.

## Decision

Add an optional `prepareStage(stage, input)` host hook to the provider-neutral owner contract. The owner calls it before the pre-stage currency check. A non-null result settles the stage without running it; otherwise, the owner continues with the check and `runStage`. Post-stage input and currency checks apply to both paths.

The runtime host implements the hook using ADR-0486's bounded regeneration: a canonical or normalization review with stale bound context returns to its producing stage, at most three times per obligation. Any other source drift still fails the pre-stage check.

## State, events, privacy, and failure meaning

No event, state, or failure code changes. A regenerated review records ADR-0486's `review_context_regenerated` receipt.

## Verification

- An owner-level test must show that a prepared host result settles the stage even when the pre-stage check would throw `review_context_stale`. The same test must fail on the ADR-0486 owner.
- A runtime test must show that `prepareStage` returns `null` for current context and the regenerated batch for stale context. The pre-stage check must reject the stale state and accept the regenerated state.
- Installed verification must show `digimon` leaving `review_context_stale` after the upgrade. The new runtime contract reevaluates the settled stall once.
