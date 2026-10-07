# ADR-0490: Regenerate stale semantic candidates before the pre-stage check

Status: `accepted`
Decision date: 2026-10-07
Amends: [ADR-0486](0486-regenerate-stale-semantic-candidates-and-reuse-repository-observation.md)

## Context

`main` `f4185055` (ADR-0486) was deployed on the WSL host on 2026-10-07. `digimon`'s Node then ran runtime `41465145`. At 03:20:16 UTC, `digimon` requeued its settled `canonical_review` once, as ADR-0485 intends after a deploy. The stage settled again as `attention_required/review_context_stale` 0.18 s later. It had no evidence hash and no assignment, and the batch's `reviewContextRegenerations` stayed unset.

The owner checks currency with `host.assertCurrent(state)` before it calls `host.runStage`. ADR-0486 regenerated a stale review only inside `runStage`. The pre-stage check runs the same bound-context fence, so it threw `review_context_stale` first, and regeneration was never reached. ADR-0486's tests called `runStage` directly and missed the owner's order.

## Decision

The provider-neutral owner contract gains an optional `prepareStage(stage, input)` host hook, which the owner calls before its pre-stage currency check. A non-null result settles the stage without running it. Otherwise the owner continues with the check and `runStage` as before, and the post-stage input and currency checks apply to both paths.

The runtime host implements the hook with ADR-0486's bounded regeneration. A canonical or normalization review whose bound context is stale returns to its producing stage, at most three times per obligation. Any other source drift still fails the pre-stage check.

## State, events, privacy, and failure meaning

No event, state, or failure code changes. A regenerated review records ADR-0486's `review_context_regenerated` receipt.

## Verification

- An owner-level test must show that a host's prepared result settles the stage although the pre-stage check would throw `review_context_stale`. The same test must fail on the ADR-0486 owner.
- A runtime test must show that `prepareStage` returns `null` for a current context, and returns the regenerated batch when the context is stale. The pre-stage check must reject the stale state and accept the regenerated one.
- Installed verification must show `digimon` leaving `review_context_stale` after the upgrade. The new runtime contract reevaluates the settled stall once.
