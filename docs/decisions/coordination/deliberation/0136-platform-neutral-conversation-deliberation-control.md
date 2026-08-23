# ADR-0136: Platform-Neutral Conversation Deliberation Control

> [ADR-0141](0141-explicit-durable-conversation-deliberation-resume.md) later adds an explicit resume command, separate authority, and a durable resume queue.

- Status: accepted
- Decision date: 2026-08-21

## Context

Slack and Discord are only transports. Every adapter, including first-party chat, needs the same internal commands without turning ordinary conversation or inferred intent into execution.

## Decision

@lervo/conversation-control deterministically parses only:

- /lervo deliberate start <policy-id> -- <topic>
- /lervo deliberate status <deliberation-id>

Start accepts stored policies only; natural language, reactions, and mentions do not start work. Normalized inbound events and commands reach a platform-neutral port without transport IDs.

Project and human principal must have explicit deliberation.start or deliberation.read authority. Backends may connect to local execution or a durable queue without the common contract assuming sync/async behavior. Responses are limited to running, unknown, interrupted, converged, no_consensus, failed, artifact count, and next action. Unprovable liveness remains unknown.

Start carries the canonical source event ID, and the backend must durably deduplicate on projectId plus sourceEventId before any long execution. Responses pass chat writing evaluation and a content-bound permit, are stored in CAS, and are delivered by the outbox; responders never call platforms directly. Receiving a command proves no role loaded, injected, or used content.

## Consequences

New platforms implement only inbound and delivery contracts. Missing authorization or backend configuration fails visibly.
