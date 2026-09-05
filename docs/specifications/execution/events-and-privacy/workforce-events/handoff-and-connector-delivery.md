# Handoff and connector delivery

`assignment.handoff.recorded` is the canonical success evidence for one assignment mention route. The mention plan itself is not an event or effect. Thread and inbox views rebuild from the handoff's assignment, sender, recipient, request digest, artifact, context-event, and time coordinates.

The event proves only that workforce state and the route record committed together. It does not prove message delivery, acknowledgment, provider receipt, understanding, action, review, verification, or consensus. Bodies and mention prose remain excluded.

Assignment connector delivery adds no repository event. Its injected adapter durably owns `reserved`, `current`, or `conflict` pre-send state and `delivered`, `rejected`, or `unknown` terminal observation. Core validation binds exact plan, outbound, connector, internal destination, reservation, attempt, receipt-hash, delivery-key-hash, bounded failure-code, and time fields.

Native platform identifiers, credentials, content bodies, paths, and unrestricted errors remain adapter private. Unknown means an effect may have occurred and never authorizes automatic retry. Connector delivery does not upgrade workforce route, acknowledgment, attention, or execution evidence.
