# ADR-0143: Harden Execution-Evidence and Conversation Boundaries

- Status: accepted
- Decision date: 2026-08-22

## Context

Default event pages could hide terminal evidence, deliberation restoration collected unrelated project history, and provider signals were unbounded. Conversation composition supported only two platforms, while storage and runtime packages depended upward on implementations. Workspace I/O, snapshot validation, and execution finalization also had overlapping responsibilities.

## Decision

`@lervo/storage-contract` provides a forward-only snapshot visitor and explicitly bounded run collector. Deliberation and managed-conversation validation read at most 2,000 run events and fail on overflow, reversal, or incorrect coordinates. Restoration streams only through the starting project head and retains target coordinates.

Managed provider signals default to 500, with a configurable absolute maximum of 10,000. Invalid configuration fails before startup; overflow closes as `provider_stream_failed` without telemetry. A shared `@lervo/execution-contract` constant caps managed-run evidence at 2,000. No new payloads or raw provider, tool, or command data are stored.

`apps/conversation` composes a `ConversationIntegrationDeployment` registry. Built-in Slack and Discord factories and external/native adapters use the same registry. `platform=null` means canonical Lervo coordinates without external-ID mapping; otherwise `adapterKind` must match a safe, bounded platform name. SQLite schema v2 generalizes kinds while preserving all v1 rows and relations.

Queue contracts move to `@lervo/conversation-deliberation-contract`, and managed evidence validation moves to `@lervo/execution-contract`. Adapters depend only downward. Start and resume stores share low-level SQLite integrity and rollback while retaining distinct policies. CI rejects production cycles, package dependencies on apps, implementation dependencies from contracts, and their transitive paths.

The composition root injects the writing contract, and resume verifies its canonical hash. Separate modules own workspace state/publication, atomic document materialization, runtime transitions, snapshot restoration, and provider result/finalization. Paths are validated before writes; malformed nested snapshots close as `runtime_snapshot_invalid`.

## Consequences

Evidence no longer depends on page defaults or total history. Excessive streams fail explicitly, new platforms register without editing app core, and dependency direction is enforced. Increasing limits requires renewed memory, telemetry, privacy, and regression review. Future derived indexes must preserve source validation and snapshot meaning.
