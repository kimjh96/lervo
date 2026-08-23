# ADR-0143: Harden Execution-Evidence and Conversation Boundaries

- Status: accepted
- Decision date: 2026-08-22

## Context

Default event pages could hide terminal evidence; deliberation restoration collected unrelated project history; provider signals were unbounded. Conversation composition was closed to two platforms, and storage/runtime packages depended upward on implementations. Workspace I/O, snapshot validation, and execution finalization also had overlapping responsibilities.

## Decision

@lervo/storage-contract provides a forward-only snapshot visitor and explicitly bounded run collector. Deliberation and managed-conversation validation read at most 2,000 run events and fail on overflow, reversal, or wrong coordinates. Restoration streams only through the starting project head and retains target coordinates.

Managed provider signals default to 500 with a configurable absolute maximum of 10,000. Invalid configuration fails before startup; overflow closes provider_stream_failed without telemetry. One shared @lervo/execution-contract constant caps managed-run evidence at 2,000. No new payloads or raw provider/tool/command data are stored.

apps/conversation composes a ConversationIntegrationDeployment registry. Built-in Slack and Discord factories and external/native adapters use the same registry. platform=null means canonical Lervo coordinates without external-ID mapping; otherwise adapterKind must match a safe bounded platform name. SQLite schema v2 generalizes kinds while preserving all v1 rows and relations.

Queue contracts move to @lervo/conversation-deliberation-contract and managed evidence validation to @lervo/execution-contract. Adapters depend only downward. Start/resume stores share low-level SQLite integrity and rollback while retaining distinct policies. CI rejects production cycles, app dependencies from packages, implementation dependencies from contracts, and their transitive paths.

The composition root injects the writing contract and resume checks its canonical hash. Workspace state/publication, atomic document materialization, runtime transitions, snapshot restoration, and provider result/finalization become separate modules. Paths are validated before writes; malformed nested snapshots close runtime_snapshot_invalid.

## Consequences

Evidence no longer depends on page defaults or total history, excessive streams fail explicitly, new platforms register without editing the app core, and dependency direction is enforced. Increasing limits requires renewed memory, telemetry, privacy, and regression review. Future derived indexes must preserve source validation and snapshot meaning.
