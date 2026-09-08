# ADR-0392: Installed proactive signals and managed conversation deliberation

- Status: accepted
- Decision date: 2026-09-09

## Context

The conversation contract supported proactive participation and a durable deliberation queue, but installed Node deployments configured neither signal producers nor a deliberation executor. Discord could answer repository-grounded messages but could not initiate a useful contribution after a repository event or execute an explicit deliberation command.

Putting either behavior in the Discord adapter would make the current surface own repository policy. Importing CLI application internals into the Node application would reverse the package dependency direction. Replaying event payloads into chat would disclose data outside the event privacy contract.

## Decision

An optional Node repository-signal source reads the canonical local project event chain through the event-store port. On first enablement, it checkpoints the current head without replaying historical events. Each configured exact event-type mapping creates the existing `signal.raised` conversation event for its bounded conversation set. Required fields are the common conversation fields plus a configured `signalCode`; the actor is `system`, mentions are empty, and automation depth is zero. Content includes only the source event type and signal code, excluding event payloads, prompts, credentials, provider output, and platform identifiers. Before replying, the selected agent must retrieve current state through the ordinary managed repository context path.

The rebuildable `repository-signal-cursor.json` projection contains the schema version, project ID, integration ID, last fully dispatched source sequence, and update time. It is an owner-only atomic current file, not an event or knowledge source. A missing cursor starts at the current event head. Invalid coordinates, a cursor beyond the current head, read failure, CAS failure, or dispatch failure produces `repository_signal_failed`; the Node fails closed rather than skipping an unknown interval. A crash before cursor advancement may replay a signal, but interaction idempotency uses the deterministic source-event hash to prevent duplicate publication.

Proactive production is enabled only when the participation policy explicitly uses `proactive`, permits the `system` actor, and subscribes to every mapped signal code. Existing cooldown, hourly response limit, automation-depth limit, deterministic multi-agent turn ownership, relevance policy, typing lifecycle, provider budget, and terminal failure behavior remain in force. Unconfigured deployments produce no signals.

Installed deliberation uses the existing platform-neutral durable queue and explicit `/lervo deliberate` commands. Exact human participant bindings separately grant start, read, and resume permissions. Explicit deliberation commands bypass model intent classification and enter the queue immediately; ordinary natural language cannot start deliberation.

The Node owns queue polling and invokes an executable adapter instead of importing CLI application code. The adapter passes the topic only on stdin and supplies the queue-assigned deliberation ID, expected project ID, repository root, and operation as separate bounded coordinates. The internal assigned-worker CLI calls the existing managed deliberation lifecycle, preserving repository search, context evidence, Codex or Claude provider adapters, verification, CAS artifacts, event recording, leases, and exact project checks. Only a matching terminal status and artifact count settle the queue. Spawn failure, timeout, oversized or malformed output, non-terminal output, and coordinate mismatch become `deliberation_execution_uncertain`; they never automatically replay an unprovable provider execution.

No new global event type is introduced. Canonical deliberation events, CAS artifacts, the queue database, and the repository event chain retain their existing ownership. Discord receives only a writing-gated conversational status. A future Lervo surface can supply the same normalized inbound event and deliberation port without using Discord.

## Consequences

Installed agents can react to bounded repository signals and run explicit cross-provider deliberation without bypassing Lervo retrieval, evidence, budgets, or authority. Transport, signal production, queue control, process execution, and managed provider work have independent failure boundaries and tests.

First enablement intentionally ignores historical events. Recovering an uncertain deliberation still requires authoritative reconciliation before resume. Discord application provisioning and the real two-bot acceptance remain external platform work.

## References

- [Platform-neutral deliberation control](../deliberation/0136-platform-neutral-conversation-deliberation-control.md)
- [Durable conversation deliberation queue](../deliberation/0138-durable-conversation-deliberation-queue.md)
- [Managed deliberation binding](../deliberation/0139-conversation-queue-managed-deliberation-binding.md)
- [Single managed conversation turn](0389-single-managed-conversation-turn.md)
- [Deterministic multi-agent turn ownership](0391-deterministic-multi-agent-turn-ownership.md)
