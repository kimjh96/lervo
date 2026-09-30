# Supervision event contract

All supervision events use envelope version 3. Required payload fields are `schemaVersion: 1`, `projectId`, `workstreamId`, `workstreamRevision`, `supervisionId`, `ownerAgentId`, `mandateHash`, and `causationEventIds`. IDs and digests are bounded.

Exclude raw user text, prompts, reasoning, paths, external message identifiers, credentials, and provider output. Reference human-readable material by governed artifact hash.

Each event below adds the listed required fields.

## `work.supervision.mandate.installed`

Fields: mandate ID/version, mandate artifact hash, installation review hash, reviewer identity digest, predecessor mandate hash or null.

Records an exact installation review and separate CAS bytes. Validate current authority before effects.

## `work.supervision.mandate.revoked`

Fields: mandate ID, revocation coordinate hash, reviewer identity digest.

Stops new admission, but not already-started external effects.

## `work.supervision.effect.observed`

Fields: decision ID, plan hash, status, effect event IDs.

Status is `recorded`, `effect_confirmed`, or `uncertain`. Confirmation requires nonempty canonical evidence and exact effect inspection.

## `work.supervision.readiness.failed`

Fields: decision ID, plan hash, assignment ID, executor ID, responsibility artifact hash, source revision digest, readiness evidence hash, reason code.

Records observed worker readiness failure before any effect invocation for a recorded decision, such as operating-system permission denial on the configured provider or tool executable. Identity binds only the decision and failed checks; an identical repeated failure appends nothing. Unobserved probes never qualify. Proves safe non-start, not later repair, resumed execution, or reassignment.

## `work.supervision.preflight.blocked`

Fields: decision ID, plan hash, effect contract, source revision digest, inspection artifact hash, failure phase, reason code.

A final pre-effect check stopped one recorded invocation before the effect adapter ran. One causal decision event is required. Private CAS inspection records bounded witness hashes, timestamps, and check kinds; absent probes remain unavailable, not failed. An identical decision and inspection append once.

After exact non-start supersession, the unresolved event blocks a fresh owner proposal. The same pending decision may be rechecked after repair. The event does not itself prove repair, authorize replay or spend, or settle a prior external effect. Deploy compatible CLI, Hub, and Node readers before its writer can run. See ADR-0431.

## `work.supervision.preflight.resolved`

Fields: blocked event ID/hash, exact non-start supersession event ID/hash, newer source snapshot event ID/hash, review artifact hash, reviewer ID digest, resolution kind.

A separately reviewed source change made one blocked effect inapplicable. Envelope v3 and payload v1 require the three causal event IDs in that order and `resolutionKind` of `reviewed_source_change` or `reviewed_authority_change`.

For `reviewed_authority_change`, the third causal event is the later `work.supervision.mandate.installed` event, not a workstream snapshot. Its mandate must be current, unrevoked, and appointed by the reviewer. Its owner spend allowance must anchor at a revocation recorded after the block so an exhausted epoch cannot be reused.

The reviewer approves the exact review artifact hash. Elapsed time, mandate renewal, or a new workstream alone cannot admit the event. Before append, the writer must verify source currency, exact non-start, reviewer authority, event head, and owner fence. Public payload excludes rationale, source paths and bytes, provider output, credentials, and external message IDs. Missing or conflicting proof leaves the block unresolved. Readers may accept this event before any writer is enabled.

## `work.supervision.bound`

Fields: request artifact hash, acceptance artifact hash, expected graph hash.

One installed owner binds a bounded local or authenticated Discord request to the current reviewed workstream and assignment graph. Raw text, external IDs, and exact reply origin stay in local CAS. Conflicting ownership or a second origin rejects. Binding is not execution or delivery.

## `work.responsibility.bound`

Fields: assignment ID/revision, executor ID, reviewer ID, role ID/version/hash, responsibility artifact hash, predecessor binding hash or null.

Binds exact duties. Stale roles, conflicting live leases, and authority overflow reject.

## `work.supervision.decision.recorded`

Fields: decision ID, source revision digest, action kind, plan hash, plan artifact hash, rationale artifact hash, policy review hash or null, disposition.

Disposition is `admitted`, `blocked`, or `uncertain`. Admission does not prove an effect.

## `work.supervision.decision.superseded`

Fields: decision ID, plan hash, inspection artifact hash, replacement source revision digest.

Closes a proven not-started old-source decision under the effect adapter's source lock and owner fence. Never cancels or confirms an executed effect.

## `work.supervision.owner_reasoning.interruption_reconciled`

Fields: decision ID, plan hash, managed run ID, terminal event ID, diagnostic artifact hash.

An owner-fenced, invocation-proven read-only owner turn already ended with either nonretryable `provider_stop_failed` after a read-only start or nonretryable `provider_start_failed` before start acknowledgement. Both have unavailable usage.

Preserves the original terminal and full spent-unknown reservation. Does not prove zero tokens, successful work, safe replay, or publication. Missing or changed proof leaves the decision uncertain.

## `work.supervision.review.recorded`

Fields: assignment IDs, artifact hashes, verification event IDs, acceptance hash, reviewer ID, verdict.

Verdict is `accepted`, `rework`, or `blocked`. Missing mandatory evidence prevents acceptance.

## `work.supervision.escalation.recorded`

Fields: escalation ID, recipient ID, reason code, evidence event IDs, decision artifact hash, next check time.

Routes an issue, not ownership. Undelivered escalation retains owner responsibility.

## `work.supervision.handoff.offered`

Fields: `decisionId`, `planHash`, `handoffHash`, `recipientProjectId`, `recipientWorkstreamId`, `recipientAgentId`.

Records an exact admitted local offer. The source retains follow-up responsibility until the successor accepts.

## `work.supervision.handoff.accepted`

Fields: `decisionId`, `planHash`, `handoffHash`, `sourceProjectId`, `sourceWorkstreamId`, `sourceOfferEventId`, `sourceOfferEventHash`, `acceptanceArtifactHash`.

The recipient accepts the exact scoped offer under its own owner fence. Foreign event references do not merge histories or transfer leases.

## `work.supervision.peer.observed`

Fields: `peerProjectId`, `routeHash`, `peerObservationHash`.

Records a bounded host-observed peer view, available or unavailable, stored in local CAS. Observation is not authority. Events exclude paths, request text, and error details.

## `work.supervision.workspace.prepared`

Fields: decision ID, plan hash, assignment ID, workspace ID, provision-plan hash, workspace artifact hash, coordination evidence hash.

Proves historical exact host preparation under its admitted decision. Dispatch requires fresh workspace and lease evidence. Partial preparation remains uncertain.

## `work.supervision.delivery.queued`

Fields: decision ID, plan hash, completion event ID, result artifact hash, candidate artifact hash, outbound artifact hash.

Exact admitted publication is queued; this does not prove delivery success.

## `work.supervision.delivery.observed`

Fields: decision ID, plan hash, outbound ID, attempt number, status, receipt artifact hash or null, reason code, next check time or null.

Allows one to four transport attempts. `delivered` requires a matching receipt and no next check. Failed attempts retain the outbound, exclude raw errors, and may schedule another attempt before expiry. Attempt four has no next check.
