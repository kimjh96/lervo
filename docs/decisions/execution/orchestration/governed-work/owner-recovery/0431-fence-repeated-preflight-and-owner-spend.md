# ADR-0431: Fence repeated preflight and owner reasoning spend

Status: proposed
Decision date: 2026-09-24

## Context

Kael's recorded dispatches repeatedly stopped before managed-worker invocation. r71 observed an expired final admission witness; r72 observed an expired readiness witness. r73 aligns those witnesses, but no post-r73 worker run proves that correction installed successfully. A pre-effect `SupervisionPreflightError` currently updates only transient supervision attention. The recorded decision and exact non-start evidence remain separate, and an expired or changed-source decision may be superseded before the same underlying blocker is repaired. Replanning can then invoke the owner model again without making worker progress.

The installed V3 mandate uses `aggregateTokenPolicy: per_attempt_only`, so its `maximumAggregateTokens` field does not constrain cumulative admission. Nine owner-reasoning usage receipts after the v2 installation account for 631,128 observed tokens. This is neither the complete historical usage nor a cost estimate. Revocation at event 8648 has stopped new supervision admission; it does not settle pending dispatch 8647 or authorize another owner attempt.

## Proposed decision

### Durable non-start barrier

Add a versioned `work.supervision.preflight.blocked` event for an exact recorded decision only when the effect adapter proves it has not invoked an external effect. Bind the decision ID, plan hash, effect contract, source revision digest, bounded failure phase and reason code, and a content-addressed inspection of the final admission/readiness witnesses. The inspection must distinguish an observed failed check, a stale witness, and an unavailable witness; it must not represent an unobserved check as a failed one. Its event identity is deterministic for the same decision and witness set. Repeated checks append no duplicate.

The event uses envelope version 3 and payload version 1. Its additional required fields are `decisionId`, `planHash`, `effectContract`, `sourceRevisionDigest`, `inspectionArtifactHash`, `failurePhase`, and `reasonCode`, besides the common supervision coordinates and causal decision event ID. The event and public status contain no request text, prompts, source paths, provider output, credentials, raw exception, or external message ID. `preflight.blocked` means only that this invocation did not begin; it does not prove repair, cancel a prior effect, supersede the decision, or complete the assignment. If invocation absence cannot be proved, retain `uncertain` and use the existing effect reconciliation path.

Project a barrier from the canonical event chain, not from health memory or an outbox. Before another owner proposal, first inspect the pending decision and its effect evidence. If the same blocker persists, report attention without model work. A plan deadline may require exact non-start supersession, but supersession alone does not clear the barrier. Clear it only after fresh, complete admission/readiness witnesses prove the implicated condition repaired, or after a reviewed goal/source change that makes the blocked effect inapplicable. An unrelated event-head change, timer tick, restart, or installation revision is not repair evidence. Recheck the barrier and effect absence under the owner fence at the transition to any new proposal or worker invocation.

### Independent owner-spend admission

Separate the owner-reasoning spend boundary from a worker's per-attempt policy. Before provider start, reserve the maximum owner tokens against a reviewed cumulative allowance for the exact goal lineage; count observed usage and all unresolved reservations. An unavailable usage receipt retains the full reservation until exact reconciliation. The read must be complete and bounded or admission fails closed. Mandate succession does not reset historical use. A new incremental allowance, if the owner approves one, must identify its own reviewed authority and starting event coordinate; it cannot reinterpret the old 100,000 field or erase the 631,128 observed tokens. No allowance is inferred from an attempt-count change or from this ADR.

Reservation and admission must be serialized with the existing owner lease, with a final authority/budget recheck before provider start. A provider response that exceeds its reservation is an explicit overrun and blocks further owner starts pending review; it is never silently charged as zero. The guard covers source-change replanning as well as normal retries and applies to both Codex and Claude adapters through the common execution contract.

### Reader-first activation

Deploy CLI, Hub, and Node readers for the new event and any allowance artifact before the writer. The writer stays disabled until deterministic replay, restart, lost-response, duplicate-event, stale-witness, unknown-usage, revocation, successor-mandate, and competing-owner fixtures pass. Activation requires a reviewed mandate and an installed canary showing one blocked preflight produces no repeated owner invocation while ordinary Discord conversation remains responsive. An exact repaired witness must then permit at most one newly admitted continuation; worker start, review, publication, and knowledge currency remain independent acceptance gates.

## Open authority choice

The owner has approved supervisor-only revocation and a separate reapproval procedure, not an exact post-revocation token allowance. Whether 200,000 means additional tokens after revocation or no further spend is pending explicit choice. Until that decision and the cumulative guard are reviewed, supervision remains revoked. Dispatch 8647 may be closed only with its existing exact non-start and owner-fence contract under authority valid for that recovery; read-only absence observation is insufficient.

## References

- [Supervision events](../../../../../specifications/execution/outcome-supervision/contracts/events.md)
- [Managed run supersession](../../../../../specifications/execution/outcome-supervision/implementation/managed-execution/worker/supersession.md)
- [Owner reasoning](../../../../../specifications/execution/outcome-supervision/implementation/owner-reasoning.md)
- [ADR-0400](../0400-prove-default-model-supervision-budget-comparability.md)
- [Installed observations](../../../../../roadmap/product-outcome-convergence/execution/outcome-supervision/delivery/status/installed-observations.md)
