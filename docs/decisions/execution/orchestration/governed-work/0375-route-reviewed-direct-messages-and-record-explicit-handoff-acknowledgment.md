# ADR-0375: Route reviewed direct messages and record explicit handoff acknowledgment

- Status: `accepted`
- Decision date: 2026-09-05

## Context

Lervo could resolve mentions, record assignment handoffs, project threads and inboxes, and deliver artifacts through outbound connectors. Acknowledgment was intentionally unobserved. Conversation adapters normalized inbound messages, but no installed route bound a message to workforce authority. Treating any inbound message as assignment authority, inferring acknowledgment from delivery, or replaying a source event into duplicate handoffs would weaken the evidence model.

## Decision

Add the provider-neutral `AssignmentMessageTriggerAdapterV1` and one installed implementation, `lervo/reviewed-message-file`. Its source evidence is `reviewed_input`, not platform-authenticated delivery. A bounded observation contains only internal event, project, workstream, agent, artifact-hash, source-key-hash, and time coordinates.

Build a pure trigger plan over the existing assignment-mention plan. `assignment trigger` requires exact plan/apply with `--write`, re-inspects the adapter, and delegates mutation to `recordAssignmentHandoff`. Trigger provenance is additive handoff state and `assignment.handoff.recorded` metadata. Adapter, assignment, and source-event-key hash provide durable assignment-scoped idempotency: exact replay returns current state; changed reuse blocks. The host remains responsible for explicit cross-assignment interpretation.

Add an independent recipient-coordinate-only `acknowledgeAssignmentHandoff` transition and `assignment acknowledge` command. The transition atomically writes the acknowledgment time and `assignment.handoff.acknowledged`; exact replay creates neither a revision nor another event. The local command validates the active agent coordinate and role contract but does not authenticate a human principal. Assignment communication contract v2 projects this evidence without changing connector delivery or subsequent action. Contract v1 remains unchanged.

Expose both commands additively through product-host protocol v4. Its thread and inbox routes explicitly select communication contract v2. Keep protocols v1 through v3 byte-compatible. The packed external consumer must route and acknowledge one reviewed message using only the public CLI artifact.

## Privacy and failure meaning

Triggering and acknowledgment retain no message body, repository path, credential, platform-native identifier, provider output, reasoning, or actor prose. Reviewed input does not prove external authentication. A trigger plan proves no mutation; a recorded handoff proves only the workforce route; acknowledgment proves only that the exact active recipient-agent coordinate was supplied to the explicit transition. None proves human identity, delivery, understanding, action, approval, verification, or provider execution.

Malformed, unavailable, mismatched, stale, unauthorized, expired, or conflicting inputs record no success. State/event failure restores the previous assignment. Automatic retry, scheduling, claim, provider startup, and task completion remain unauthorized.

## Consequences

The first installed message-to-handoff journey preserves review, route, acknowledgment, and action as separate states. Future Slack, Discord, Hub, webhook, timer, or approval-resolution triggers can implement the same adapter boundary without changing workforce authority, but require their own source authentication, recovery, and installed acceptance.

## References

- [Reviewed direct-message triggers and acknowledgment](../../../../specifications/execution/assignment-message-triggers.md)
- [Assignment interactions](../../../../specifications/execution/assignment-interactions.md)
- [Assignment routines](../../../../specifications/execution/assignment-routines.md)
- [Product-host protocol](../../../../specifications/execution/product-host-protocol.md)
- [Product outcome convergence](../../../../roadmap/product-outcome-convergence.md)
