# ADR-0431: Fence repeated preflight and owner reasoning spend

Status: proposed
Decision date: 2026-09-24

## Context

Kael's recorded dispatches repeatedly stopped before managed-worker invocation. r71 observed an expired final admission witness; r72 observed an expired readiness witness. r73 aligns those witnesses, but no post-r73 worker run proves that correction installed successfully. A pre-effect `SupervisionPreflightError` currently updates only transient supervision attention. The recorded decision and exact non-start evidence remain separate, and an expired or changed-source decision may be superseded before the same underlying blocker is repaired. Replanning can then invoke the owner model again without making worker progress.

The installed V3 mandate uses `aggregateTokenPolicy: per_attempt_only`, so its `maximumAggregateTokens` field does not constrain cumulative admission. Nine owner-reasoning usage receipts after the v2 installation account for 631,128 observed tokens. This is neither the complete historical usage nor a cost estimate. Revocation at event 8648 (`evt_57e4827d6d60c9b66ebc7ff718f3be59`, `sha256:99f5cc9e9add1557d26c316e3b807d890af031ff8a953ab9a1c1b18daf0d83d2`) has stopped new supervision admission; it does not settle pending dispatch 8647 or authorize another owner attempt.

Read-only inspection of the bound Kael goal found 55 owner-reasoning runs: 49 provider-reported observed receipts totaling 3,364,545 tokens, and six unavailable receipts whose 100,000-token reservations remain spent-unknown. The existing whole-group projection returns `observedAggregateTokens: null` and `reservedAggregateTokens: 5,500,001` because one partial usage group makes it charge historical observed runs at their full reservations as well. That number is a conservative projection, not actual use. Historical receipts also span multiple model descriptors, so summing their reported counters into a new comparable admission budget without an explicit policy would be unsound.

## Proposed decision

### Durable non-start barrier

Add a versioned `work.supervision.preflight.blocked` event for an exact recorded decision only when the effect adapter proves it has not invoked an external effect. Bind the decision ID, plan hash, effect contract, source revision digest, bounded failure phase and reason code, and a content-addressed inspection of the final admission/readiness witnesses. The inspection must distinguish an observed failed check, a stale witness, and an unavailable witness; it must not represent an unobserved check as a failed one. Its event identity is deterministic for the same decision and witness set. Repeated checks append no duplicate.

The event uses envelope version 3 and payload version 1. Its additional required fields are `decisionId`, `planHash`, `effectContract`, `sourceRevisionDigest`, `inspectionArtifactHash`, `failurePhase`, and `reasonCode`, besides the common supervision coordinates and causal decision event ID. The event and public status contain no request text, prompts, source paths, provider output, credentials, raw exception, or external message ID. `preflight.blocked` means only that this invocation did not begin; it does not prove repair, cancel a prior effect, supersede the decision, or complete the assignment. If invocation absence cannot be proved, retain `uncertain` and use the existing effect reconciliation path.

Project a barrier from the canonical event chain, not from health memory or an outbox. Before another owner proposal, first inspect the pending decision and its effect evidence. If the same blocker persists, report attention without model work. A plan deadline may require exact non-start supersession, but supersession alone does not clear the barrier. Clear it only after fresh, complete admission/readiness witnesses prove the implicated condition repaired, or after a reviewed goal/source change that makes the blocked effect inapplicable. An unrelated event-head change, timer tick, restart, or installation revision is not repair evidence. Recheck the barrier and effect absence under the owner fence at the transition to any new proposal or worker invocation.

The barrier projection must follow the standing supervision lineage across successor workstreams. A successor ID or new workstream cannot hide a prior unresolved block. A confirmed effect may close only the matching decision, plan hash, and workstream; an unrelated effect cannot repair it. Source-change resolution still requires a separate reviewed, causally bound repair event before a fresh owner proposal.

### Independent owner-spend admission

Separate the owner-reasoning spend boundary from a worker's per-attempt policy. Before provider start, reserve the maximum owner tokens against a reviewed cumulative allowance for the exact owner lineage; count every admitted owner reservation after the allowance anchor, including failed, unavailable, and unresolved invocations. A proven non-start may be refunded only by a separate exact causal rule; absence of a usage receipt is never zero. The read must be complete and bounded or admission fails closed. Mandate succession must retain the same allowance anchor and ceiling, not create a fresh 200,000-token grant per goal. The historical 631,128 observed tokens and all unknown reservations remain canonical outside the new epoch; the old `maximumAggregateTokens` field is not reinterpreted.

The owner selected the procedure for **up to 200,000 additional tokens after revocation**, not automatic mandate installation or immediate model work. The epoch must bind the exact event-8648 ID and hash, the appointed owner, a reviewed authority artifact, and a 200,000-token ceiling. Until an explicit comparable-receipt rule is reviewed, conservatively retain each post-anchor owner reservation at its full amount even when its final usage is lower; this bounds potential spend across model changes without treating different model counters as interchangeable. An over-reservation, unavailable usage receipt, or observed overrun blocks further starts and requires review. Installing an old `per_attempt_only` successor without this independent boundary must not bypass the guard.

Reservation and admission must be serialized with the existing owner lease, with a final authority/budget recheck before provider start. A provider response that exceeds its reservation is an explicit overrun and blocks further owner starts pending review; it is never silently charged as zero. The guard covers source-change replanning as well as normal retries and applies to both Codex and Claude adapters through the common execution contract.

The spend check also runs before an owner-reasoning proposal is recorded. If the epoch cannot admit one more full reservation (an unavailable receipt, an overrun, or insufficient remaining tokens), the native owner proposes nothing and supervision reports `owner_plan_unavailable` attention. Otherwise every re-proposal of a plan that expires before its execution-time recheck records another full reservation that was never spendable. The execution-time check stays authoritative; the earlier check only prevents recording unspendable decisions.

A preceding owner run that failed with `provider_usage_limited` ends automatic owner reasoning for that mandate history. Retrying before the provider restores the allowance cannot succeed, and each retry would reserve more tokens. Resuming requires a reviewed mandate change, which starts a new owner-reasoning history.

### Reader-first activation

Deploy CLI, Hub, and Node readers for the new event and any allowance artifact before the writer. The writer stays disabled until deterministic replay, restart, lost-response, duplicate-event, stale-witness, unknown-usage, revocation, successor-mandate, and competing-owner fixtures pass. Activation requires a reviewed mandate and an installed canary showing one blocked preflight produces no repeated owner invocation while ordinary Discord conversation remains responsive. An exact repaired witness must then permit at most one newly admitted continuation; worker start, review, publication, and knowledge currency remain independent acceptance gates.

The source implementation now records bounded inspection evidence and retains an unresolved barrier after supersession. It deliberately fails closed rather than claiming automatic repair when the old plan's source binding changed. The same pending decision can be rechecked after repair; a different plan requires exact repair or reviewed intervention. The incremental allowance uses full post-anchor decision reservations, so it does not silently refund observed underspend or unavailable usage. Reader-first deployment and installed acceptance remain separate from these source tests.

## Activation authority

The owner chose the incremental 200,000-token procedure. This is not approval of an unreviewed mandate artifact or provider start. Supervision remains revoked until the cumulative guard, durable preflight barrier, compatible readers, exact pending-effect recovery, and separately reviewed successor installation are verified. Dispatch 8647 may be closed only with its existing exact non-start and owner-fence contract under authority valid for that recovery; read-only absence observation is insufficient.

An installed mandate's revocation denies new worker effects and owner reasoning, but does not erase authority to record that an already recorded dispatch never started. The managed-execution supersession reader may use the exact revoked installation only for this terminal non-start transition: it must re-read the canonical recovery source, prove the run has no effect events (or only the separately admitted reservation-only shape), require the plan deadline or changed source, hold the owner lease, and recheck the event head and absence in the append transaction. Any partial or uncertain run remains blocked. This transition emits only the existing `work.supervision.decision.superseded` event; it grants no new decision, lease, worker invocation, or token spend. If source or owner authority changes before commit, it fails without an event. A fresh mandate is still required before further work.

## References

- [Supervision events](../../../../../specifications/execution/outcome-supervision/contracts/events.md)
- [Managed run supersession](../../../../../specifications/execution/outcome-supervision/implementation/managed-execution/worker/supersession.md)
- [Owner reasoning](../../../../../specifications/execution/outcome-supervision/implementation/owner-reasoning.md)
- [ADR-0400](../0400-prove-default-model-supervision-budget-comparability.md)
- [Installed observations](../../../../../roadmap/product-outcome-convergence/execution/outcome-supervision/delivery/status/installed-observations.md)
