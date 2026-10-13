# ADR-0516: Hold owner planning while a dispatch's worker readiness is blocked

Status: `accepted`
Decision date: 2026-10-13
Related: [ADR-0431](0431-fence-repeated-preflight-and-owner-spend.md)

## Context

axli's product-owner responsibility requires `role.organization.decision`. Its Node has no verification tools or suite pins for that suite, and the knowledge readiness of the responsibility's paths awaits a reviewed normalization of `docs/product/vision.md`. Every dispatch therefore stops at the final readiness gate with `readiness_tools_unobserved`, `readiness_knowledge_unobserved` and `readiness_verification_unobserved`.

The gate recorded only transient attention. When the claim's lease lapsed, the source changed and the pending dispatch was superseded. The owner was then asked again and produced the same plan:

1. owner reasoning;
2. a new claim;
3. a new workspace;
4. a dispatch blocked on the same readiness.

The cycle repeated about every eight minutes. Between 10:15 and 11:05 UTC on 2026-10-13, it spent 373,028 owner tokens and left a new retained checkout each time. ADR-0431 fences preflight blocks found at effect time. This gate came earlier and bypassed that fence.

## Decision

- When the final readiness gate blocks a worker dispatch, or its readiness probe cannot complete (for example `supervision_readiness_stale`, recorded as `readiness_unobservable`), the supervision runtime holds owner planning for that supervision. A failed probe still fails its cycle as before. The hold records:
  - the exact plan;
  - its `readiness_*` reasons;
  - the cause of the blocked cycle;
  - a digest of the Node's readiness inputs.
- `readReadinessInputs(plan)` is an optional port. The Node implements it as a hash of its runtime readiness configuration, the knowledge source snapshot of the plan's paths, and whether that knowledge is ready. None of these depends on the plan's lease.
- Before asking the owner for a plan, a held supervision re-reads those inputs. While the inputs and the cause are unchanged, it records `worker_readiness_unavailable` with the held reasons and waits. It neither asks the owner, nor claims, nor prepares a workspace.
- The hold is released when the inputs change or can no longer be read, when a new cause arrives (a new workstream snapshot), or when a worker dispatch reaches its effect.
- Holds live in the runtime process. A restart, which is how new Node configuration takes effect, clears them, and the owner may then plan once more.

## Consequences

A readiness gap that only an operator can repair costs no owner tokens and creates no checkouts while it remains. New user input still reaches the owner. The hold adds no canonical event and grants no authority. It only withholds a model invocation that could not make progress.

## Deployment note

The first deployment held only gate-blocked dispatches. On axli the probe instead exceeded its five-second bound and threw, so the hold never engaged and two more re-planning rounds spent 191,371 tokens. Probe failures now hold as well.

## Verification

- Orchestrator tests:
  - after a readiness-blocked dispatch is superseded, the next cycle records `worker_readiness_unavailable` without proposing;
  - changed readiness inputs let the owner plan again;
  - a new cause releases the hold;
  - a readiness probe that throws also holds owner planning once its dispatch is superseded.
    Without the hold, the first test proposes again.
- Node test: the readiness-input digest is stable for unchanged inputs and changes with configuration or repository knowledge.
