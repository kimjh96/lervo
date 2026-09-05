# Reviewed direct-message triggers and handoff acknowledgment

Status: `active`
As of: 2026-09-05

## Scope

This specification defines one provider-neutral, installed message-to-handoff journey: a content-addressed direct-message observation enters existing assignment-mention authority through a versioned trigger adapter, with later acknowledgment for the exact active recipient-agent coordinate. It adds no chat database, implicit assignment creation, provider startup, approval inference, scheduler, or automatic action.

## Reviewed trigger adapter

`AssignmentMessageTriggerAdapterV1` inspects one bounded direct-message observation. Its descriptor binds adapter ID and semantic version, a content-derived descriptor hash, `direct_message.handoff`, availability, source-evidence meaning, review boundary, replay protection, and external-identifier handling.

The installed `lervo/reviewed-message-file` adapter reports `sourceEvidence: reviewed_input`, without claiming platform authentication or live delivery. Its observation retains only an internal conversation event ID, source-event-key hash, project and workstream, source and recipient agents, content-addressed artifact coordinate, and occurrence time. It excludes message bodies, repository paths, credentials, native conversation or participant identifiers, prompts, provider output, and actor prose.

`lervo assignment trigger --from <request.json>` first builds a read-only plan binding the current adapter descriptor, source observation, assignment revision, exact source lease, direct recipient, content artifact, request digest, context evidence, and underlying assignment-mention plan. Apply requires the exact plan ID and `--write`, re-inspects the adapter, rebuilds the plan, and delegates the only mutation to the existing workforce handoff transition. This exact plan/apply boundary is the installed explicit review boundary. It neither identifies nor authenticates a human reviewer; the input file alone grants no write authority.

The adapter, assignment, and source-event-key hash form the idempotency coordinate. Exact replay within that assignment returns `current` and the original handoff without another event. Reuse within the assignment with different route or content coordinates is `source_event_conflict` and records nothing. Cross-assignment message interpretation is an explicit host decision, not a hidden global lock. Existing lease expiry, role policy, workstream scope, identity activity, assignment revision, and target resolution remain owned by the assignment-mention and workforce transitions.

## Explicit acknowledgment

`lervo assignment acknowledge` requires the exact assignment, handoff, active recipient-agent coordinate, and `--write`. It revalidates that agent's current role contract, rejects a different agent coordinate, and atomically records `acknowledgedAt` with `assignment.handoff.acknowledged`. The local CLI does not authenticate a human principal; hosts must add that boundary before mapping an external actor to the agent coordinate. Exact replay is current and emits no second event.

Assignment communication contract v2, selected with `loop thread|inbox --contract 2` and used by product-host protocol v4, exposes `acknowledgementState: recorded` and its time only from this canonical state. Contract v1 and product-host protocols v1 through v3 remain unchanged. `deliveryState` remains `unobserved`.

Acknowledgment proves only that the exact recipient-agent coordinate was explicitly supplied to the acknowledgment transition. It proves neither human identity, connector delivery, understanding, task acceptance, lease acquisition, action, review, verification, nor completion.

## Events, privacy, and failure meaning

Triggered `assignment.handoff.recorded` events add only trigger kind, adapter ID and version, descriptor hash, internal source event ID, and source-event-key hash to existing assignment, handoff, agent, request, artifact, and context coordinates. `assignment.handoff.acknowledged` requires assignment ID, handoff ID, recipient agent ID, acknowledgment time, and resulting assignment revision.

Both events exclude bodies, paths, credentials, native identifiers, provider data, and unrestricted errors. State and event commit together; event-append failure restores the prior assignment bytes. Adapter, source, route, lease, recipient, role-contract, time, or idempotency conflict records no success. Neither event authorizes provider work or unattended continuation.

## Required verification

Focused tests must cover:

- Descriptor hashing and exact message and handoff binding.
- Unavailable or mismatched sources, assignment-scoped source-event conflict, and idempotent replay.
- Recipient-coordinate acknowledgment, event rollback, and privacy allowlists.
- Acknowledgment projection without delivery inference.
- CLI plan/apply.
- The packed external-consumer trigger-to-acknowledgment journey without Hub, provider, network, or private workspace imports.

## References

- [Assignment interactions](assignment-interactions.md)
- [Assignment connector delivery](assignment-connectors.md)
- [Execution events and privacy](events-and-privacy.md)
- [ADR-0375](../../decisions/execution/orchestration/governed-work/0375-route-reviewed-direct-messages-and-record-explicit-handoff-acknowledgment.md)
