# ADR-0011: Managed provider run lifecycle and repository boundary

- Status: `accepted`; ADR-0013 extends the write boundary
- Decision date: 2026-08-18

## Context

Codex and Claude implement common session, controlled-context, turn, and signal contracts, but no owner connected the M2 gate to a provider process as one run. Arbitrary composition could start turns before injection, miss compaction, leak processes after cancellation, or treat provider-written files as verified `file.changed` events.

The adapters initially lacked a policy bridge for per-file, one-use permits and byte verification, so this lifecycle is read-only. Normalized signals omit final response bodies, requiring a separate result-artifact contract.

## Decision

### Responsibilities

- `ManagedProviderRunCoordinator` orders request handling, repository snapshots, adapter start, context preparation and injection, turn execution, signal consumption, cancellation, shutdown, and terminal run events.
- Delegate E1–E3 and generation to `ManagedContextRun`, stream termination to a signal monitor, and adapter contracts, deadlines, failure ledger, shutdown, and snapshots to separate modules.
- Depend only on the provider-neutral `ProviderAdapter` port. Each coordinator instance serves one run.
- Isolate-copy inputs except functions and `AbortSignal` to prevent external mutation of in-flight decisions.

### Lifecycle and events

Normal order:

1. `run.requested`, then `run.resolved`
2. Pre-run repository snapshot
3. Adapter start and `adapter.started`
4. E1/E2 preparation and controlled E3 injection
5. Target turn and normalized signal consumption
6. Adapter stop and `adapter.stopped`
7. Post-run snapshot comparison
8. `run.completed`, or `unmanaged_change.detected` plus `run.failed`

Compaction or restart immediately invalidates the old generation, independently of the terminal result. Cancellation closes the adapter with reason `cancelled`. A stream ending before a terminal signal is `provider_stream_failed`, never completion.

Use existing event types with these key payloads:

- `run.requested`: `requestDigest`, role, risk
- `run.resolved`: role, risk, policy version
- `adapter.started`: adapter identity/version, provider session, execution mode, capabilities
- `tool.called`: tool name, input digest, status, duration
- `command.executed`: command digest, repository-relative cwd, status, exit code, output digest, duration
- `unmanaged_change.detected`: sorted relative paths and before/after revisions
- `run.completed`: result digest, artifact IDs, verification status
- `run.failed`: failure code, retryability, and diagnostic digest of all phase/code entries

Preserve `command.executed.status` in the event allowlist. Events must never store raw commands, output, tool input, tasks, or provider results.

### Repository snapshot and initial write policy

Safely hash every regular file's bytes under the repository. Do not follow symlinks; hash their link targets. Use fixed markers for other entries. Exclude `.git`, `.lervo/state`, dependency trees, and conventional generated build/cache directories, including `node_modules`, `dist`, `build`, `coverage`, `.next`, `.turbo`, `.expo`, `.gradle`, `.cxx`, `.vercel`, `Pods`, and `vendor`. The snapshot makes no claim about excluded paths. Repository-authored `generated/` remains included unless repository policy excludes it.

Default limits are 20,000 entries and 256 MiB of regular files, configurable by repository policy. Invalid policy, overflow, concurrent mutation, unsafe roots, or read failure produces `repository_snapshot_failed`.

This slice is read-only. Before provider start, reject roles whose `filesystem.write` is not `deny`. Any revision change emits `unmanaged_change.detected` with every affected relative path, fails with `unmanaged_change_detected`, and emits no `file.changed`.

Require `executionMode=read_only` in the request and session. Codex requires a read-only sandbox and `never`; Claude requires `plan` with only a subset of `Read`, `Glob`, and `Grep`.

Default deadlines are 30 seconds for snapshots, 10 minutes for the provider turn, 5 seconds for stream cleanup, and 10 seconds for stop. Adapter transports own cancellable deadlines for start, injection, and turn start. A timeout does not prove termination: abort and stop separately without abandoning state-changing promises through a race.

Accumulate all failures. Select the representative outcome using this precedence: telemetry, stop, unmanaged, contract, snapshot, context, provider-execution, then cancellation. Digest the complete ledger so concurrent facts remain represented.

### Failure semantics and privacy

| Code | Meaning |
| --- | --- |
| `cancelled` | Caller aborted; close the adapter as cancelled. |
| `context_preparation_failed`, `context_injection_failed` | E2/E3 failed; do not continue to turn or change. |
| `provider_start_failed`, `provider_turn_failed`, `provider_stream_failed`, `provider_stop_failed` | A provider stage did not complete; claim no normal lifecycle. |
| `repository_snapshot_failed` | Repository state cannot be safely compared; fail closed. |
| `unmanaged_change_detected` | Changes outside verified permits remain; do not present a managed result. |
| `telemetry_recording_failed` | A required event transaction failed; do not start or stop execution. |
| `contract_validation_failed` | Common coordinates differ; reject the affected stage. |

Persist only SHA-256 digests for requests, results, and diagnostics. Paths must be repository-relative. Raw context, tasks, results, output, and provider errors remain outside events.

## Consequences

- Both providers pass one lifecycle fixture and start turns only after injection.
- Capability reports alone cannot promote provider changes to verified `file.changed`.
- Coordinator, gate, monitor, contracts, failures, and snapshots can evolve independently.
- ADR-0012 adds result artifacts; ADR-0013 adds the managed per-path write bridge while retaining unmanaged-change detection.
