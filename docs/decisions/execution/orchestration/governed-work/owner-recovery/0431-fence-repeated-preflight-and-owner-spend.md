# ADR-0431: Fence repeated preflight and owner reasoning spend

Status: proposed
Decision date: 2026-09-24

## Context

Kael's recorded dispatches repeatedly stopped before managed-worker invocation: r71 observed an expired final admission witness; r72 observed an expired readiness witness. r73 aligns them, but no post-r73 worker run proves the correction installed successfully. A pre-effect `SupervisionPreflightError` updates only transient supervision attention, leaving the recorded decision separate from exact non-start evidence. An expired or changed-source decision may be superseded before its underlying blocker is repaired, allowing replanning to invoke the owner model without worker progress.

The installed V3 mandate uses `aggregateTokenPolicy: per_attempt_only`, so `maximumAggregateTokens` does not constrain cumulative admission. Nine owner-reasoning usage receipts after v2 installation report 631,128 observed tokens; this is neither complete historical usage nor a cost estimate. Revocation at event 8648 (`evt_57e4827d6d60c9b66ebc7ff718f3be59`, `sha256:99f5cc9e9add1557d26c316e3b807d890af031ff8a953ab9a1c1b18daf0d83d2`) stopped new supervision admission but neither settles pending dispatch 8647 nor authorizes another owner attempt.

Read-only inspection of the bound Kael goal found 55 owner-reasoning runs: 49 provider-reported observed receipts totaling 3,364,545 tokens, plus six unavailable receipts whose 100,000-token reservations remain spent-unknown. The whole-group projection returns `observedAggregateTokens: null` and `reservedAggregateTokens: 5,500,001`: one partial usage group causes historical observed runs to be charged at full reservations too. This is a conservative projection, not actual use. Receipts span multiple model descriptors; summing their counters into a comparable admission budget requires an explicit policy.

## Proposed decision

### Durable non-start barrier

Add a versioned `work.supervision.preflight.blocked` event for an exact recorded decision only when the effect adapter proves it has not invoked an external effect. Bind the decision ID, plan hash, effect contract, source revision digest, bounded failure phase and reason code, and a content-addressed inspection of final admission/readiness witnesses. Inspection must distinguish observed failed checks, stale witnesses, and unavailable witnesses; it must not report an unobserved check as failed. Event identity is deterministic for the same decision and witness set; repeated checks append no duplicate.

Use envelope version 3 and payload version 1. Besides common supervision coordinates and the causal decision event ID, require `decisionId`, `planHash`, `effectContract`, `sourceRevisionDigest`, `inspectionArtifactHash`, `failurePhase`, and `reasonCode`. Event and public status exclude request text, prompts, source paths, provider output, credentials, raw exception, and external message ID.

`preflight.blocked` means only that this invocation did not begin. It proves no repair, cancels no prior effect, supersedes no decision, and completes no assignment. If invocation absence cannot be proved, retain `uncertain` and use existing effect reconciliation.

Project the barrier from the canonical event chain, not health memory or an outbox. Before another owner proposal, inspect the pending decision and effect evidence. If the same blocker persists, report attention without model work. A plan deadline may require exact non-start supersession, but supersession alone does not clear the barrier. Clear it only when fresh, complete admission/readiness witnesses prove the implicated condition repaired, or a reviewed goal/source change makes the blocked effect inapplicable. An unrelated event-head change, timer tick, restart, or installation revision is not repair evidence. Recheck the barrier and effect absence under the owner fence when transitioning to any new proposal or worker invocation.

Follow the standing supervision lineage across successor workstreams: a successor ID or new workstream cannot hide an unresolved block. A confirmed effect may close only the matching decision, plan hash, and workstream; unrelated effects cannot repair it. Source-change resolution requires a separate reviewed, causally bound repair event before a fresh owner proposal.

### Independent owner-spend admission

Separate owner-reasoning spend admission from worker per-attempt policy. Before provider start, reserve maximum owner tokens against a reviewed cumulative allowance for the exact owner lineage. Count every admitted owner reservation after the allowance anchor, including failed, unavailable, and unresolved invocations. Refund a proven non-start only under a separate exact causal rule; missing usage is never zero. Admission fails closed unless the read is complete and bounded.

Mandate succession retains the allowance anchor and ceiling; it must not create another 200,000-token grant per goal. Only explicit revocation followed by reviewed installation may open a new epoch, anchored at the exact revocation event so all earlier reservations remain in the closed epoch. Derived goals and unrevoked version changes retain the current anchor and ceiling. Historical 631,128 observed tokens and all unknown reservations remain canonical outside the new epoch. Do not reinterpret the old `maximumAggregateTokens` field.

The owner selected a procedure for **up to 200,000 additional tokens after revocation**, not automatic mandate installation or immediate model work. Bind the epoch to the exact event-8648 ID and hash, appointed owner, reviewed authority artifact, and 200,000-token ceiling. Until an explicit comparable-receipt rule is reviewed, retain each post-anchor owner reservation in full even when final usage is lower. This bounds potential spend across model changes without equating different model counters. An over-reservation, unavailable usage receipt, or observed overrun blocks further starts and requires review, subject to the later terminated-turn amendment below. An old `per_attempt_only` successor without this independent boundary must not bypass the guard.

Serialize reservation and admission with the existing owner lease; recheck authority and budget immediately before provider start. A response exceeding its reservation is an explicit overrun that blocks further owner starts pending review, never a zero charge. Apply the guard to source-change replanning and normal retries, and to Codex and Claude adapters through the common execution contract.

Also check spend before recording an owner-reasoning proposal. If the epoch cannot admit another full reservation because of blocking unavailable usage, overrun, or insufficient remaining tokens, the native owner proposes nothing and supervision reports `owner_plan_unavailable` attention. Without this early check, each re-proposal of a plan expiring before execution-time recheck records another reservation that was never spendable. The execution-time check remains authoritative; the earlier check prevents unspendable decisions.

**Comparable-receipt rule (reviewed 2026-09-25).** Since ADR-0432, Node enforces each owner turn's reservation during the run using the receipt's measure: turn-cumulative total tokens, cached input included. A run's observed receipt from the decision's provider is therefore comparable to its reservation, and the decision is charged at the observed total. A decision without a receipt, including a running decision, retains its full reservation. Under this rule, unavailable receipts and observed overruns still block further starts; the terminated-turn amendment below narrows the unavailable-receipt block. The owner approved comparability after Kael exhausted a 3,000,000-token epoch with five Claude turns charged at 600,000 each, while provider-reported use was about 1,240,000.

**Non-start refund rule (2026-09-25).** Charge a decision nothing only when both conditions hold:

- A `work.supervision.decision.superseded` event binds its decision ID and plan hash.
- Its deterministic run ID has no event at all, including no reservation.

Any run event keeps the full reservation under this non-start refund rule. On Kael, two owner decisions superseded after a hung login probe had consumed 1,200,000 epoch tokens although no provider started.

A preceding owner run that failed with `provider_usage_limited` ends automatic owner reasoning for that mandate history. Retrying before the provider restores allowance cannot succeed and reserves more tokens. Resumption requires a reviewed mandate change, which starts a new owner-reasoning history.

An owner-spend-exhaustion block has no source change to review, and its superseded decision can never confirm an effect. Resolve it through `reviewed_authority_change`, requiring all of:

- Exactly one supersession proving the blocked decision's non-start.
- A later, current mandate installation for the same owner lineage, appointed by the reviewer.
- An owner spend allowance anchored at a revocation recorded after the block.
- The reviewer's approval of the exact review hash.

`lervo agent mandate resolve-preflight` prints the review and records it only with `--approve <hash> --write` under the supervision owner lease. The append transaction rechecks the block, non-start, installation, and absence of later revocation. Mandate installation alone never clears a block.

### Reader-first activation

Deploy CLI, Hub, and Node readers for the new event and any allowance artifact before the writer. Keep the writer disabled until deterministic replay, restart, lost-response, duplicate-event, stale-witness, unknown-usage, revocation, successor-mandate, and competing-owner fixtures pass.

Activation requires a reviewed mandate and an installed canary proving that one blocked preflight causes no repeated owner invocation while ordinary Discord conversation remains responsive. An exact repaired witness must then permit at most one newly admitted continuation. Worker start, review, publication, and knowledge currency remain independent acceptance gates.

The source implementation records bounded inspection evidence and retains unresolved barriers after supersession. It fails closed when the old plan's source binding changes instead of claiming automatic repair. The same pending decision may be rechecked after repair; a different plan requires exact repair or reviewed intervention. The incremental allowance charges each post-anchor decision its full reservation until an observed provider receipt exists and never refunds unavailable usage. Source tests do not establish reader-first deployment or installed acceptance.

## Activation authority

The owner's choice of the incremental 200,000-token procedure approves neither an unreviewed mandate artifact nor provider start. Supervision remains revoked until verification of the cumulative guard, durable preflight barrier, compatible readers, exact pending-effect recovery, and separately reviewed successor installation. Close dispatch 8647 only through its existing exact non-start and owner-fence contract under authority valid for that recovery; read-only absence observation is insufficient.

Revoking an installed mandate denies new worker effects and owner reasoning but does not erase authority to record that an existing dispatch never started. The managed-execution supersession reader may use the exact revoked installation only for this terminal non-start transition. It must re-read the canonical recovery source, prove no run effect events exist (or only the separately admitted reservation-only shape), require the plan deadline or changed source, hold the owner lease, and recheck event head and absence in the append transaction. Partial or uncertain runs remain blocked.

This transition emits only the existing `work.supervision.decision.superseded` event. It grants no new decision, lease, worker invocation, or token spend. Source or owner-authority changes before commit cause failure without an event. Further work requires a fresh mandate.

## References

- [Supervision events](../../../../../specifications/execution/outcome-supervision/contracts/events.md)
- [Managed run supersession](../../../../../specifications/execution/outcome-supervision/implementation/managed-execution/worker/supersession.md)
- [Owner reasoning](../../../../../specifications/execution/outcome-supervision/implementation/owner-reasoning.md)
- [ADR-0400](../0400-prove-default-model-supervision-budget-comparability.md)
- [Installed observations](../../../../../roadmap/product-outcome-convergence/execution/outcome-supervision/delivery/status/installed-observations.md)

## Amendment 2026-09-25: terminated turns without usage

The unavailable-usage rule previously blocked the whole owner spend epoch to account for a potentially running turn. Kael's first owner turn under a freshly reinstalled mandate failed in nine seconds without usage, silently blocking all later owner turns for hours.

A turn with `run.failed` or `run.completed` can no longer spend, and ADR-0432 caps it at its reservation. Charge such a turn its full reservation when usage is unavailable. Only a turn without a terminal event remains uncertain and blocks the epoch.
