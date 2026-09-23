# ADR-0425: Separate webhook publication from task control

- Status: accepted
- Decision date: 2026-09-23

## Context

The Shiflo co-resident hired agents use distinct Discord webhooks. Twelve immutable outbounds reached `attention_required` after three `adapter_delivery_failed` attempts: all twelve were `observe_only`, and nine also carried `task.result`. The webhook adapter rejected both attributes before beginning platform replay. A webhook message has no bot-authenticated nonce, so merely removing that check would publish text without preserving the observation or coordination contract. The co-resident peer router already delivers the task result to the coordinator as a separately authenticated receiver-owned event after the worker's publication.

## Decision

A webhook publication is presentation, not a task-control envelope. An unaddressed webhook message is normalized as `observe_only` at authenticated Discord ingress. An exact explicitly addressed webhook message remains `eligible`; the existing identity mapper must resolve the address before participation. Webhook delivery may publish an `observe_only` message only when its content contains no potential Discord user, role, or leading textual address. It may carry `task.result` in the canonical outbound record only as a co-resident result presentation; the webhook body does not claim to transmit that coordination to a remote receiver. Other coordinated webhook outbounds remain rejected before replay. The co-resident peer router remains responsible for the exact task-ID result event and coordinator receipt.

Remote Discord task delegation requires application-bot identities at both ends because its installed coordination transport uses the authenticated bot nonce. If either source speaker or target peer is webhook-backed and the exact co-resident receiver is unavailable, delegation fails before an assignment is published. A future cross-Node webhook task requires the authenticated receiver-owned envelope described by [ADR-0421](../agent-organization/0421-separate-real-agent-discussion-from-policy-coverage.md), not a hidden text marker, guessed webhook reply, or spoofable display name.

No new global event or durable state is added. The existing `audienceParticipation` values remain `eligible` and `observe_only`; `task.result` retains its opaque task ID and coordinator participant ID. Ingress stores message content under the existing conversation CAS privacy scope. Failure to preserve a webhook observation or remote coordination contract is a bounded pre-send `platform_delivery_failed` or delegation error, not evidence of Discord publication. An outbox already in `attention_required` is not automatically retried or marked delivered; [ADR-0424](0424-bound-delivery-uncertainty-and-reconciliation.md) continues to govern its reconciliation.

## Consequences

Routine status and co-resident task-result text can be visible under the worker's real webhook identity without accidentally opening another automated turn. Remote webhook task coordination remains explicitly unavailable until a durable authenticated control transport exists. Component tests do not replace a new installed two-direction normal, redelivery, failure, retry, and restart run, and the twelve historical Shiflo outbounds remain unresolved pending exact delivery evidence or a separately reviewed nonpublication disposition.
