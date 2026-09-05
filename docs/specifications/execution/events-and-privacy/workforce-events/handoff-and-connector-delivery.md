# Handoff and connector delivery

## Handoff evidence

`assignment.handoff.recorded` is the canonical success evidence for one assignment mention route. The mention plan is neither an event nor an effect. Thread and inbox views rebuild from the handoff's assignment, sender, recipient, request digest, artifact, context-event, and time coordinates.

The event proves only that workforce state and the route record committed together. It does not prove message delivery, acknowledgment, provider receipt, understanding, action, review, verification, or consensus. Bodies and mention prose remain excluded.

## Connector delivery

Assignment connector delivery adds no repository event. Its injected adapter durably owns `reserved`, `current`, or `conflict` pre-send state and `delivered`, `rejected`, or `unknown` terminal observation. Core validation binds exact plan, outbound, connector, internal destination, reservation, attempt, receipt-hash, delivery-key-hash, bounded failure-code, and time fields.

Native platform identifiers, credentials, content bodies, paths, and unrestricted errors remain adapter private. Unknown means an effect may have occurred and never authorizes automatic retry. Connector delivery does not upgrade workforce route, acknowledgment, attention, or execution evidence.

## Reviewed direct-message triggers

Reviewed direct-message triggers add bounded adapter, descriptor-hash, internal source-event, and source-key-hash provenance to `assignment.handoff.recorded`. The installed file adapter proves reviewed input, not platform authentication or delivery.

Exact source replay within an assignment is current; conflicting reuse in that assignment records nothing. Cross-assignment interpretation remains a host decision.

## Acknowledgment

`assignment.handoff.acknowledged` records assignment ID, handoff ID, exact recipient agent ID, acknowledgment time, and resulting assignment revision after the recipient-coordinate state transition commits.

The local transition validates the active agent coordinate and role contract but does not authenticate a human principal. It upgrades only `acknowledgementState`; delivery, attention, understanding, action, lease, approval, verification, and completion remain separate.
