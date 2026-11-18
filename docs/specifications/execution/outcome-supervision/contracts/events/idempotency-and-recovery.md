# Idempotency and recovery

## Managed invocation and role inputs

Keyed managed invocation uses envelope-version-3 `managed.execution.reserved`, a generic managed-execution event outside the supervision journal. Required payload fields `executionKey` and `requestHash` are SHA-256 digests. It records one prelude reservation before any provider call and excludes the request, paths, credentials, and owner token. A reservation without a causal/request record means an unresolved invocation, not safe absence or successful dispatch.

Generic envelope-version-3 `role.input.bound` records exact prepared role inputs before provider creation. Required fields are `schemaVersion: 1`, `roleId`, `roleContractHash`, `inputContractId`, `inputArtifactHash`, and `inputByteCount`. It excludes raw inputs and proves no delivery or use. Research acceptance independently binds this event to the producer's verified result and the separate evaluator's run; see [research inputs and independent acceptance](../../implementation/research-execution.md).

## Decision identity and effect evidence

Decision idempotency derives from supervision ID, cause events, source revisions, action kind, and plan hash. Existing hire, handoff, run, verification, and completion events prove effects.

For `work.artifact_review.v1`, the existing review event can confirm only its exact preceding admitted owner decision. Its deterministic identity and causal references bind that decision and the returned terminal event; the concrete inspector also checks the CAS effect and policy. This exception cannot let a decision confirm itself or admit unrelated supervision records as effects. See [canonical owner artifact review](../../implementation/managed-execution/artifact-review.md).

After a decision followed by a crash, reconcile against those events; never blindly re-execute the decision. Extend any effect API lacking recoverable idempotency before unattended use.

Scoped offer and acceptance receipts confirm only their own exact admitted decisions. Local `work.owner_attention.v1` uses the escalation event with the owner as recipient, its original semantic basis in CAS, and `nextCheckAt: null`. Unchanged attention waits for new canonical facts, or until the escalation bound passes, without implying central delivery. See [scoped owner handoffs](../../implementation/scoped-handoffs.md).

## Escalation capacity

The snapshot's `escalationCount` is the bounded number of matching canonical escalation events after the latest reviewed installation of the supervision's mandate. It is not a retry counter that stops being readable at the action limit. That installation is the human decision answering earlier escalations and opens a fresh owner spend epoch.

Eight or more events, or owner attention pending for 30 minutes (ADR-0453 `escalationBatchWindowMs`), pass the escalation bound. As amended by [ADR-0561](../../../../../decisions/foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md), the owner is then no longer waited on. Pending attention stops blocking, and the principal proxy turns any further escalation into the first settling action the installed mandate permits: `revise_responsibility` or `allocate_existing` for rejected, blocked, or failed work, and `inspect_uncertain_effect` for an uncertain effect. The report reason becomes `principal_proxy_<reason>`, and the owner reasoning turn is offered no `escalate` operation. When no permitted action settles the reason, such as another project's pending handoff acceptance, or the mandate has expired, the report has status `lervo_debt` with reason `principal_scope_exceeded` or `principal_mandate_expired`. Health records it as attention with reason codes `lervo_debt` and the reason, and it stays held until its source changes. An owner attention plan proposed past the bound is refused as the same debt. Before the bound, a waiting report carries `nextCheckAt` at the moment the bound passes. A longer valid history remains readable up to the execution-event source bound.

Before this rule was amended on 2026-09-25, thirteen escalations from interrupted workers left Kael unable to escalate an exhausted rework for the rest of its goal.

## Assignment replacement

An assignment created after a rework rejection replaces it. While that rejection stands, the owner may only request rework, escalate, or allocate a fresh assignment. A later non-cancelled assignment is therefore its replacement, even when the owner rewrote the acceptance criteria.

The task observation reports the replaced assignment in `replacedAssignmentIds` and excludes it from `assignments`. Routing, owner completion, the goal-completion basis, and result publication all ignore it; the accepted replacement satisfies the goal. A cancelled assignment without a binding is settled and never reported as unbound work.

Before this rule was amended on 2026-09-26, the first version matched replacements by acceptance hash. Kael's replacement dropped a criterion the worker could not meet, leaving the goal blocked.

## Publication and completion receipts

The exact `work.supervision.delivery.queued` event may confirm its preceding `publish_result` decision through a separate narrow receipt check. The concrete inspector verifies canonical plan and queue bytes. Neither a later delivery observation nor an unrelated supervision event can confirm an arbitrary decision.

Canonical goal completion uses the existing `workstream.snapshot.recorded` event and exact predecessor and successor snapshot hashes.

## Preflight retry and resolution

A preflight records a durable block only after it fails twice. An unclassified failure, such as an observation that changed while being read, is retried once first. A real change of authority or readiness fails again and is blocked.

Owner escalations, artifact reviews, and goal completions whose receipt never took effect can be superseded under a fenced absence proof, `work.owner_attention_absence` or `work.owner_control_absence`. That proof is required by `resolve-preflight`.

Before this rule was amended on 2026-09-27, three transient observation races on 2026-09-26 left Kael's owner blocked until operator intervention. The last, on an artifact review, could not be resolved at all.
