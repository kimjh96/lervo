# Handoff and acknowledgment

## Handoff evidence

`assignment.handoff.recorded` is the canonical success evidence for one assignment handoff. Thread and inbox views rebuild from the handoff's assignment, sender, recipient, request digest, artifact, context-event, and time coordinates.

The event proves only that workforce state and the route record committed together. It does not prove message delivery, acknowledgment, provider receipt, understanding, action, review, verification, or consensus. Bodies and request prose remain excluded.

## Stored trigger provenance

Handoffs recorded by the reviewed direct-message trigger that [ADR-0560](../../../../decisions/foundation/0560-remove-unused-subsystems-to-harden-the-core.md) removed carry bounded adapter, descriptor-hash, internal source-event, and source-key-hash provenance on `assignment.handoff.recorded`. New handoffs no longer add it, and stored events that carry it stay valid and readable.

## Acknowledgment

`assignment.handoff.acknowledged` records assignment ID, handoff ID, exact recipient agent ID, acknowledgment time, and resulting assignment revision after the recipient-coordinate state transition commits.

The local transition validates the active agent coordinate and role contract but does not authenticate a human principal. It upgrades only `acknowledgementState`; delivery, attention, understanding, action, lease, approval, verification, and completion remain separate.
