# Workforce events

Workforce events contain only opaque agent, assignment, lease, handoff, artifact, context-event, role/task, role-version, role-contract-hash, status, generation, expiry, and digest coordinates. They exclude role prose and source paths, task prose, acceptance text, repository paths, prompts, outputs, artifact bodies, reasoning, credentials, and provider configuration.

State and event commit together, restoring bytes on event failure. Invalid or stale role contracts, contention, expiry, and rejected claims record no execution success.

## Routine assignment provenance

Routine-created `assignment.created` events additionally retain nullable required-capability hash, routine ID, template version and hash, invocation ID, `manual` trigger kind and digest, node key, and approval digest. They exclude the template, trigger request, idempotency key, criteria, approval text, and paths.

These fields prove deterministic assignment provenance, not trigger delivery, scheduling, claim, provider startup, or execution. Historical absence means ordinary assignment creation. A failed node records no creation event; previously committed nodes remain an exact partial invocation for idempotent replan and resume.

## Handoff and connector delivery

`assignment.handoff.recorded` is the canonical success evidence for one assignment mention route. The mention plan itself is not an event or effect. Thread and inbox views rebuild from the handoff's assignment, sender, recipient, request digest, artifact, context-event, and time coordinates.

The event proves only that workforce state and the route record committed together. It does not prove message delivery, acknowledgment, provider receipt, understanding, action, review, verification, or consensus. Bodies and mention prose remain excluded.

Assignment connector delivery adds no repository event. Its injected adapter durably owns `reserved`, `current`, or `conflict` pre-send state and `delivered`, `rejected`, or `unknown` terminal observation. Core validation binds exact plan, outbound, connector, internal destination, reservation, attempt, receipt-hash, delivery-key-hash, bounded failure-code, and time fields.

Native platform identifiers, credentials, content bodies, paths, and unrestricted errors remain adapter private. Unknown means an effect may have occurred and never authorizes automatic retry. Connector delivery does not upgrade workforce route, acknowledgment, attention, or execution evidence.

## Governed-loop projection

The governed-loop graph is rebuildable and adds no durable graph state. Its report replays current assignment state plus existing causal, run, verification, and resource events. Approval requirements leave the report only as digests.

Verified approval observations bind opaque assignment, authority, approval, evidence-hash, and validity coordinates. They exclude requirement text, approver identity, signatures, credentials, and evidence bodies. A next-action decision remains a projection, not an approval, assignment mutation, provider invocation, or completion event.

## Cancellation

`assignment.cancelled` records the opaque assignment ID, previous status, reason (`requested` or `dependency_cancelled`), exact cancellation plan ID, direct cancelled dependency IDs, resulting revision, and time. It excludes task and acceptance prose, paths, lease sessions, provider output, prompts, reasoning, credentials, and actor identity.

Success means one queued or blocked assignment state and its event committed together. Plan drift, terminal state, leased work, missing dependency evidence, contention, or event failure records no cancellation success. Event failure restores the prior assignment bytes.

## Completion preparation

`assignment.completion.prepared` records a content-derived evidence ID, workstream, assignment revision, agent, lease, accepted verification and writing-publication states, result artifact coordinates, and preparation time under the exact managed run and session envelope. It excludes task and acceptance prose, paths, prompts, provider output, artifact bodies, reviewer identity, reasoning, credentials, and provider configuration.

Success means the governed adapter observed one matching passed `run.completed` event and both completion gates while the exact lease was valid; it does not mean assignment state changed. Foreign or contradictory run history, stale coordinates, invalid timing, event failure, and historical absence create no prepared-completion claim.

## Completion reconciliation

`assignment.completion.reconciled` records the prepared-evidence and exact reconciliation command IDs, source managed run, assignment, agent, lease, result artifact coordinates, resulting revision, and time. It excludes task and acceptance prose, paths, prompts, provider output, artifact bodies, reviewer identity, reasoning, credentials, and provider configuration.

Success means the still-matching leased assignment state and event committed together. A preparation made during the original half-open `[acquiredAt, expiresAt)` lease interval may be applied after expiry.

Another revision or lease, an out-of-interval preparation, a terminal assignment, stale plan, contention, or event failure records no reconciliation success. Event failure restores the prior assignment bytes. Missing preparation remains escalation-required and never authorizes provider rerun.

## Capability registration and activation

Agent state may contain exact capability package IDs, kinds, versions, content hashes, and project or user source scopes. `capabilityHash` binds these coordinates and role-permission decisions. It excludes package bodies, publisher metadata, local paths, MCP configuration values, credentials, and Hub tokens.

Registration failure records neither a hired agent nor package authority. Capability installation and Hub publication return operation receipts, add no execution event, and prove no loading, activation, invocation, or use.

Managed `capability.activated` is emitted only after the provider adapter returns a valid exact receipt. Its envelope binds project, run, session, provider actor, and confirmation time. Its payload contains capability ID and kind, version and content hash, adapter and provider-session IDs, evidence (`mcp_connected` or `plugin_loaded`), and a privacy-bounded activation digest.

It excludes local paths, commands, arguments, URLs, configuration, credentials and credential names, plugin content, tool inventories, and raw errors. Confirmation failure or timeout emits no activation event, blocks the task turn with `capability_activation_failed`, and appears only as the bounded `run.failed` diagnostic digest. Activation proves connection or load before the turn, not invocation or use.
