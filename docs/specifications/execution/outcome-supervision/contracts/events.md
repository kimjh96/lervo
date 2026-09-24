# Persistence and versioned events

## Authority and storage

Workstreams remain goal authority; assignments remain task authority. Exact responsibility and decision artifacts use CAS and existing ownership and access rules. The local event store holds causal records; rebuildable projections cannot authorize effects.

Reuse the existing policy and approval artifact lifecycle only if it represents every mandate constraint; otherwise, version it before activation. Revocation and ancestry are mandatory. A JSON file gains no authority from existing on disk.

## Event contract

All supervision events use envelope version 3. Required payload fields are `schemaVersion: 1`, `projectId`, `workstreamId`, `workstreamRevision`, `supervisionId`, `ownerAgentId`, `mandateHash`, and `causationEventIds`. IDs and digests are bounded.

Exclude raw user text, prompts, reasoning, paths, external message identifiers, credentials, and provider output. Reference human-readable material by governed artifact hash.

| Event | Additional required fields | Meaning and failure boundary |
| --- | --- | --- |
| `work.supervision.mandate.installed` | mandate ID/version, mandate artifact hash, installation review hash, reviewer identity digest, predecessor mandate hash or null | Records an exact installation review and separate CAS bytes; validate current authority before effects. |
| `work.supervision.mandate.revoked` | mandate ID, revocation coordinate hash, reviewer identity digest | Stops new admission, but not already-started external effects. |
| `work.supervision.effect.observed` | decision ID, plan hash, status, effect event IDs | `recorded`, `effect_confirmed`, or `uncertain`; confirmation requires nonempty canonical evidence and exact effect inspection. |
| `work.supervision.readiness.failed` | decision ID, plan hash, assignment ID, executor ID, responsibility artifact hash, source revision digest, readiness evidence hash, reason code | Observed worker readiness failure before any effect invocation for a recorded decision, such as operating-system permission denial on the configured provider or tool executable. Identity binds only the decision and failed checks; an identical repeated failure appends nothing. Unobserved probes never qualify. Proves safe non-start, not later repair, resumed execution, or reassignment. |
| `work.supervision.preflight.blocked` | decision ID, plan hash, effect contract, source revision digest, inspection artifact hash, failure phase, reason code | Reader-first contract for a proved non-start at final effect preflight. One causal decision event is required. The proposed writer and durable retry barrier are inactive; merely reading this event cannot authorize replay, supersession, or new spending. See proposed ADR-0431. |
| `work.supervision.bound` | request artifact hash, acceptance artifact hash, expected graph hash | One installed owner binds a bounded local or authenticated Discord request to the current reviewed workstream and assignment graph. Raw text, external IDs, and exact reply origin stay in local CAS; conflicting ownership or a second origin rejects. Binding is not execution or delivery. |
| `work.responsibility.bound` | assignment ID/revision, executor ID, reviewer ID, role ID/version/hash, responsibility artifact hash, predecessor binding hash or null | Binds exact duties; stale roles, conflicting live leases, and authority overflow reject. |
| `work.supervision.decision.recorded` | decision ID, source revision digest, action kind, plan hash, plan artifact hash, rationale artifact hash, policy review hash or null, disposition | `admitted`, `blocked`, or `uncertain`; admission does not prove an effect. |
| `work.supervision.decision.superseded` | decision ID, plan hash, inspection artifact hash, replacement source revision digest | Closes a proven not-started old-source decision under the effect adapter's source lock and owner fence; never cancels or confirms an executed effect. |
| `work.supervision.owner_reasoning.interruption_reconciled` | decision ID, plan hash, managed run ID, terminal event ID, diagnostic artifact hash | An owner-fenced, invocation-proven read-only owner turn already ended with either nonretryable `provider_stop_failed` after a read-only start or nonretryable `provider_start_failed` before start acknowledgement; both have unavailable usage. It preserves the original terminal and full spent-unknown reservation; it does not prove zero tokens, successful work, safe replay, or publication. Missing or changed proof leaves the decision uncertain. |
| `work.supervision.review.recorded` | assignment IDs, artifact hashes, verification event IDs, acceptance hash, reviewer ID, verdict | `accepted`, `rework`, or `blocked`; missing mandatory evidence prevents acceptance. |
| `work.supervision.escalation.recorded` | escalation ID, recipient ID, reason code, evidence event IDs, decision artifact hash, next check time | Routes an issue, not ownership; undelivered escalation retains owner responsibility. |
| `work.supervision.handoff.offered` | `decisionId`, `planHash`, `handoffHash`, `recipientProjectId`, `recipientWorkstreamId`, `recipientAgentId` | Exact admitted local offer; the source retains follow-up responsibility until the successor accepts. |
| `work.supervision.handoff.accepted` | `decisionId`, `planHash`, `handoffHash`, `sourceProjectId`, `sourceWorkstreamId`, `sourceOfferEventId`, `sourceOfferEventHash`, `acceptanceArtifactHash` | Recipient accepts the exact scoped offer under its own owner fence. Foreign event references do not merge histories or transfer leases. |
| `work.supervision.peer.observed` | `peerProjectId`, `routeHash`, `peerObservationHash` | Bounded host-observed peer view, available or unavailable, stored in local CAS. Observation is not authority. Events exclude paths, request text, and error details. |
| `work.supervision.workspace.prepared` | decision ID, plan hash, assignment ID, workspace ID, provision-plan hash, workspace artifact hash, coordination evidence hash | Proves historical exact host preparation under its admitted decision; dispatch requires fresh workspace and lease evidence. Partial preparation remains uncertain. |
| `work.supervision.delivery.queued` | decision ID, plan hash, completion event ID, result artifact hash, candidate artifact hash, outbound artifact hash | Exact admitted publication is queued; does not prove delivery success. |
| `work.supervision.delivery.observed` | decision ID, plan hash, outbound ID, attempt number, status, receipt artifact hash or null, reason code, next check time or null | One to four transport attempts; `delivered` requires a matching receipt and no next check. Failed attempts retain the outbound, exclude raw errors, and may schedule another attempt before expiry. Attempt four has no next check. |

## Reader compatibility

Every stored event must satisfy a readable event schema of the reader opening the store. CLI, Node, and Hub bundles built before envelope-version-3 `work.supervision.readiness.failed` reject journals containing it with `integrity_failed` (`The stored event does not satisfy a readable event schema.`). Hub replication stops at the preceding sequence.

Before an installed owner can record this event, deploy the managed CLI bundle, Node bundle, and Hub from one revision that knows it. A mixed deployment is a non-start, not data loss.

The same reader-first rule applies to `work.supervision.owner_reasoning.interruption_reconciled`: old readers reject the new event, so deploy compatible CLI, Hub and Node readers before an explicit repair writes it. Its CAS diagnostic pins every run event and a fresh host unit-invocation witness; no prompt, output, path, source bytes or token estimate enters the event. See [ADR-0430](../../../../decisions/execution/orchestration/governed-work/owner-recovery/0430-reconcile-terminal-read-only-owner-interruptions.md).

When the concrete owner-reasoning inspector proves that exact reconciliation and failed run, `work.supervision.effect.observed` may confirm only the invocation's settled terminal state, not a successful owner result. The decision journal additionally requires the reconciliation's deterministic ID, matching decision coordinates, and the exact earlier `provider_stop_failed` terminal as its second cause. An unrelated supervision event cannot confirm a decision.

## Idempotency and recovery

Keyed managed invocation uses envelope-version-3 `managed.execution.reserved`, a generic managed-execution event outside the supervision journal. Required payload fields `executionKey` and `requestHash` are SHA-256 digests. It records one prelude reservation before any provider call and excludes the request, paths, credentials, and owner token. A reservation without a causal/request record means an unresolved invocation, not safe absence or successful dispatch.

Generic envelope-version-3 `role.input.bound` records exact prepared role inputs before provider creation. Required fields are `schemaVersion: 1`, `roleId`, `roleContractHash`, `inputContractId`, `inputArtifactHash`, and `inputByteCount`. It excludes raw inputs and proves no delivery or use. Research acceptance independently binds this event to the producer's verified result and the separate evaluator's run; see [research inputs and independent acceptance](../implementation/research-execution.md).

Decision idempotency derives from supervision ID, cause events, source revisions, action kind, and plan hash. Existing hire, handoff, run, verification, and completion events prove effects.

For `work.artifact_review.v1`, the existing review event can confirm only its exact preceding admitted owner decision. Its deterministic identity and causal references bind that decision and the returned terminal event; the concrete inspector also checks the CAS effect and policy. This exception cannot let a decision confirm itself or admit unrelated supervision records as effects. See [canonical owner artifact review](../implementation/managed-execution/artifact-review.md).

After a decision followed by a crash, reconcile against those events; never blindly re-execute the decision. Extend any effect API lacking recoverable idempotency before unattended use.

Scoped offer and acceptance receipts confirm only their own exact admitted decisions. Local `work.owner_attention.v1` uses the escalation event with the owner as recipient, its original semantic basis in CAS, and `nextCheckAt: null`. Unchanged attention waits for new canonical facts without implying central delivery. See [scoped owner handoffs](../implementation/scoped-handoffs.md).

The snapshot's `escalationCount` is the bounded cumulative number of matching canonical escalation events, not a retry counter that stops being readable at the action limit. Eight or more events suppress another escalation and report `escalation_capacity_exceeded`; a longer valid history remains readable up to the execution-event source bound.

The exact `work.supervision.delivery.queued` event may confirm its preceding `publish_result` decision through a separate narrow receipt check. The concrete inspector verifies canonical plan and queue bytes. Neither a later delivery observation nor an unrelated supervision event can confirm an arbitrary decision. Canonical goal completion uses the existing `workstream.snapshot.recorded` event and exact predecessor and successor snapshot hashes.
