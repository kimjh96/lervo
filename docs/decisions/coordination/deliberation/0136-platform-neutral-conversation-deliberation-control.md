# ADR-0136: Platform-Neutral Conversation Deliberation Control

> [ADR-0141](0141-explicit-durable-conversation-deliberation-resume.md) later adds an explicit resume command, separate authority, and a durable resume queue.

- Status: accepted
- Decision date: 2026-08-21

## Context

Slack and Discord are transports. Every adapter, including first-party chat, needs the same internal commands without turning ordinary conversation or inferred intent into execution.

## Decision

`@lervo/conversation-control` deterministically parses only:

- `/lervo deliberate start <policy-id> -- <topic>`
- `/lervo deliberate status <deliberation-id>`

Start accepts only stored policies. Natural language, reactions, and mentions never start work. Normalized inbound events and commands reach a platform-neutral port without transport IDs.

The project and human principal require explicit `deliberation.start` or `deliberation.read` authority. Backends may use local execution or a durable queue; the common contract assumes neither synchronous nor asynchronous behavior.

Responses are limited to `running`, `unknown`, `interrupted`, `converged`, `no_consensus`, `failed`, artifact count, and next action. Unprovable liveness remains `unknown`.

Start includes the canonical source event ID. Before long-running execution, the backend must durably deduplicate by `projectId` plus `sourceEventId`.

Responses must pass chat writing evaluation and a content-bound permit, be stored in CAS, and be delivered through the outbox. Responders never call platforms directly. Receiving a command does not prove that any role loaded, injected, or used content.

## Consequences

New platforms implement only the inbound and delivery contracts. Missing authorization or backend configuration fails visibly.
