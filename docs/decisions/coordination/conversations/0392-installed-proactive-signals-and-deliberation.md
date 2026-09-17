# ADR-0392: Installed proactive signals and managed conversation deliberation

- Status: accepted
- Decision date: 2026-09-09

## Context

The conversation contract supported proactive participation and a durable deliberation queue, but installed Node deployments configured neither signal producers nor a deliberation executor. Discord could answer repository-grounded messages but could not initiate contributions after repository events or execute explicit deliberation commands.

Implementing these behaviors in Discord would give the adapter repository-policy ownership. Importing CLI application internals into Node would reverse package dependencies. Replaying event payloads into chat would violate event privacy.

## Decision

### Repository signals

An optional Node repository-signal source reads the canonical local project event chain through the event-store port. First enablement checkpoints the current head without replaying history. Each configured exact event-type mapping creates an existing `signal.raised` conversation event for its bounded conversation set:

- Required fields are the common conversation fields and configured `signalCode`.
- The actor is `system`, mentions are empty, and automation depth is zero.
- Content contains only the source event type and signal code; it excludes event payloads, prompts, credentials, provider output, and platform identifiers.
- Before replying, the selected agent must retrieve current state through the ordinary managed repository context path.

The rebuildable `repository-signal-cursor.json` projection contains schema version, project ID, integration ID, last fully dispatched source sequence, and update time. It is an owner-only atomic current file, not an event or knowledge source. A missing cursor starts at the current event head. Invalid coordinates, a cursor beyond the current head, read failure, CAS failure, or dispatch failure produces `repository_signal_failed`; Node fails closed rather than skipping an unknown interval. A crash before cursor advancement may replay a signal, but interaction idempotency uses the deterministic source-event hash to prevent duplicate publication.

Proactive production requires a participation policy that explicitly uses `proactive`, permits the `system` actor, and subscribes to every mapped signal code. Existing cooldown, hourly response limit, automation-depth limit, deterministic multi-agent turn ownership, relevance policy, typing lifecycle, provider budget, and terminal failure behavior remain in force. Unconfigured deployments produce no signals.

### Installed deliberation

Installed deliberation uses the existing platform-neutral durable queue. Exact human participant bindings separately grant start, read, and resume permissions. Explicit `/lervo deliberate` commands bypass model intent classification and enter the queue immediately. ADR-0415 additionally permits natural-language start through the same port when a deployment explicitly selects a default policy.

Node owns change-driven queue execution and invokes an executable adapter instead of importing CLI application code. Durable change notifications and exact lease or reconciliation deadlines wake the worker; startup recovery performs one initial scan. The adapter passes the topic only on stdin and supplies the queue-assigned deliberation ID, expected project ID, repository root, and operation as separate bounded coordinates. The internal assigned-worker CLI calls the existing managed deliberation lifecycle, preserving repository search, context evidence, Codex or Claude provider adapters, verification, CAS artifacts, event recording, leases, and exact project checks.

Only a matching terminal status and artifact count settle the queue. Spawn failure, timeout, oversized or malformed output, non-terminal output, and coordinate mismatch become `deliberation_execution_uncertain`; they never automatically replay an unprovable provider execution.

No new global event type is introduced. Canonical deliberation events, CAS artifacts, the queue database, and the repository event chain retain their existing ownership. Discord receives only a writing-gated conversational status. A future Lervo surface can supply the same normalized inbound event and deliberation port without Discord.

The product deliberation extension also projects every newly recorded structured artifact into the exact bound origin thread. It reads `deliberation.artifact.recorded` through the shared artifact validator and emits only a bounded proposal, objection, revision, verification, or decision summary. The summary uses an existing `signal.raised` event with `signalCode: deliberation.artifact.recorded`; actor, target, reply, content-reference, automation-depth, and occurrence fields retain their existing meanings. It contains no artifact body, prompt, reasoning, provider response, credential, or native platform identifier. A fixed-contract responder publishes this Lervo-owned status without another provider turn.

The rebuildable `deliberation-artifact-cursor.json` has its own owner-only atomic cursor kind, path, and responsibility in addition to project, integration, sequence, and update-time coordinates. First enablement checkpoints the current head. A bound event advances only after exactly one interaction policy durably commits an outbound. Invalid evidence or ambiguous ownership fails before advancement; a crash before advancement is idempotent, and delivery after advancement remains recoverable through the interaction outbox. Origin-less legacy events are skipped and do not count as Discord acceptance.

## Consequences

Installed agents can react to bounded repository signals and run explicit cross-provider deliberation without bypassing Lervo retrieval, evidence, budgets, or authority. Transport, signal production, queue control, process execution, and managed provider work have independent failure boundaries and tests.

First enablement intentionally ignores historical events. The installed worker performs bounded authoritative inspection of uncertain deliberations, never reruns unproven execution, and publishes a managed completion or attention signal. Discord application provisioning and real two-bot acceptance remain external platform work.

## References

- [Platform-neutral deliberation control](../deliberation/0136-platform-neutral-conversation-deliberation-control.md)
- [Durable conversation deliberation queue](../deliberation/0138-durable-conversation-deliberation-queue.md)
- [Managed deliberation binding](../deliberation/0139-conversation-queue-managed-deliberation-binding.md)
- [Single managed conversation turn](0389-single-managed-conversation-turn.md)
- [Deterministic multi-agent turn ownership](0391-deterministic-multi-agent-turn-ownership.md)
