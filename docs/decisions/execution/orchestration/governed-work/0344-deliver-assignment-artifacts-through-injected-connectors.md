# ADR-0344: Deliver assignment artifacts through injected connectors

- Status: `accepted`
- Decision date: 2026-09-02

## Context

Lervo could record assignment handoffs and rebuild interaction threads, but intentionally reported external delivery as unobserved. A Buzz-like product needs outbound collaboration routes. Allowing room messages to create work, treating HTTP success as durable delivery, storing native room or user IDs in core state, or branching core policy by platform would create a second authority and make uncertain effects unsafe to replay.

## Decision

Add a storage-free version-1 assignment connector request and a pure, deterministic route planner. The request binds one artifact already present on one canonical `assignment.handoff.recorded` route to one content-bound chat publication permit, provider-neutral connector descriptor, and internal destination binding. Exact project, workstream, assignment revision, handoff, event, sender, recipient, request, artifact, descriptor, destination, integration, and permit hashes determine outbound, attempt, and plan identities.

Put external behavior behind an injected `AssignmentConnectorPortV1`. The default CLI can plan but has no external-delivery authority. Exact apply first re-inspects the adapter descriptor and destination and requires the reviewed plan to remain identical. The adapter must resolve and validate the full permit, artifact bytes, and private native destination, then durably reserve the attempt before sending. It returns delivered, rejected, or unknown evidence. A current durable observation is replayed without another delivery call; conflicts block, and unknown outcomes are never retried automatically.

Keep native workspace, channel, room, thread, message, and user identifiers, plus credentials, inside the adapter. Core contracts retain only internal opaque coordinates and hashes. Do not add a repository conversation store or event. The workforce handoff remains canonical route evidence; the connector owns external-effect reservation and observation. Existing thread and inbox delivery state remains unobserved until a later projection explicitly consumes connector evidence.

Inbound messages, mention-created assignments, room-based approval, task or lease mutation, acknowledgment inference, provider startup, and unattended delivery are not authorized.

## Privacy and failure meaning

Plans and observations exclude content bodies, prompts, provider output, repository paths, credentials, native identifiers, actor prose, and unrestricted errors. Reservation evidence retains only internal reservation and attempt IDs, authorization receipt hash, and time. Delivered evidence adds receipt and delivery-key hashes and time. Rejected or unknown evidence retains only its bounded failure code and attempt time.

A ready plan proves only current exact bindings. Reserved proves authorization and durable pre-send recording, not delivery. Delivered proves that the adapter retained a matching platform receipt, not human attention or action. Rejected proves a definitive platform failure. Unknown means an effect may have occurred and requires inspection rather than retry. Malformed, stale, foreign, or contradictory evidence is rejected and creates no core success claim.

## Consequences

Buzz-like products can add Slack, Discord, Teams, or future adapters without embedding platform policy in Lervo core. Paperclip-like work remains under workforce authority, and local operation remains available without a Hub. Every production adapter must pass the shared conformance cases before being wired into a host.

## References

- [Assignment connector specification](../../../../specifications/execution/assignment-connectors.md)
- [Assignment interaction specification](../../../../specifications/execution/assignment-interactions.md)
- [Governed loop roadmap](../../../../roadmap/governed-loop-assignment-graph.md)
- [Execution events and privacy](../../../../specifications/execution/events-and-privacy.md)
