# ADR-0011: Managed provider run lifecycle and repository boundary

Status: `accepted`; ADR-0013 extends the write boundary
Decision date: 2026-08-18

## Context

Codex and Claude implement the same session, controlled-context, turn, and signal contracts, but no owner connected the M2 gate to a provider process as one run. Arbitrary composition could start a turn before injection, miss compaction, leak a process after cancellation, or mistake a provider-written file for verified `file.changed`.

The adapters initially had no policy bridge for per-file one-use permits and byte verification. Therefore the first lifecycle must be read-only. It also needs a separate result-artifact contract because normalized signals intentionally omit final response bodies.

## Decision

### Responsibilities

- `ManagedProviderRunCoordinator` owns only ordering across request, repository snapshots, adapter start, context preparation/injection, turn, signal consumption, cancellation, shutdown, and terminal run events.
- Delegate E1–E3 and generation to `ManagedContextRun`; stream termination to a signal monitor; and adapter contracts, deadlines, failure ledger, shutdown, and snapshots to separate modules.
- Depend only on the provider-neutral `ProviderAdapter` port. A coordinator instance serves one run.
- Isolate-copy inputs except functions and `AbortSignal` so external mutation cannot change in-flight decisions.

### Lifecycle and events

Normal order is:

1. `run.requested`, then `run.resolved`
2. pre-run repository snapshot
3. adapter start and `adapter.started`
4. E1/E2 preparation and controlled E3 injection
5. target turn and normalized signal consumption
6. adapter stop and `adapter.stopped`
7. post-run snapshot comparison
8. `run.completed`, or `unmanaged_change.detected` plus `run.failed`

Compaction or restart immediately invalidates the old generation independently of terminal result. Cancellation closes the adapter with reason `cancelled`. A stream ending before a terminal signal is `provider_stream_failed`, never completion.

Use existing event types. Key payloads are:

- `run.requested`: `requestDigest`, role, risk
- `run.resolved`: role, risk, policy version
- `adapter.started`: adapter identity/version, provider session, execution mode, capabilities
- `tool.called`: tool name, input digest, status, duration
- `command.executed`: command digest, repository-relative cwd, status, exit code, output digest, duration
- `unmanaged_change.detected`: sorted relative paths and before/after revisions
- `run.completed`: result digest, artifact IDs, verification status
- `run.failed`: failure code, retryability, and diagnostic digest of all phase/code entries

Preserve `command.executed.status` in the event allowlist. Never store raw commands, output, tool input, tasks, or provider results in events.

### Repository snapshot and initial write policy

- Safely hash all regular-file bytes under the repository. Do not follow symlinks; hash link targets. Use fixed markers for other entries.
- Exclude `.git`, `.lervo/state`, dependency trees, and conventional generated build/cache directories such as `node_modules`, `dist`, `build`, `coverage`, `.next`, `.turbo`, `.expo`, `.gradle`, `.cxx`, `.vercel`, `Pods`, and `vendor`; the snapshot makes no claim about their immutability. Repository-authored `generated/` remains included unless an explicit repository policy excludes it.
- Default limits are 20,000 entries and 256 MiB of regular files, configurable by repository policy. Invalid policy, limit overflow, concurrent mutation, unsafe roots, or read failure is `repository_snapshot_failed`.
- This slice is read-only. Reject any role whose `filesystem.write` is not `deny` before provider start. Any revision change emits all affected relative paths as `unmanaged_change.detected`, fails with `unmanaged_change_detected`, and never emits `file.changed`.
- Require `executionMode=read_only` in request and session. Codex requires read-only sandbox and `never`; Claude requires `plan` with only a subset of `Read`, `Glob`, and `Grep`.

Default deadlines are 30 seconds for snapshots, 10 minutes for provider turn, 5 seconds for stream cleanup, and 10 seconds for stop. Adapter transports own cancellable deadlines for start, injection, and turn start. A timeout does not prove termination, so separately abort and stop; do not abandon state-changing promises through a race.

Accumulate all failures. Choose the representative outcome in telemetry, stop, unmanaged, contract, snapshot, context, provider-execution, then cancellation precedence, while digesting the complete ledger so concurrent facts are not hidden.

### Failure semantics and privacy

| Code | Meaning |
| --- | --- |
| `cancelled` | Caller aborted; close the adapter as cancelled. |
| `context_preparation_failed`, `context_injection_failed` | E2/E3 failed; do not continue to turn or change. |
| `provider_start_failed`, `provider_turn_failed`, `provider_stream_failed`, `provider_stop_failed` | The provider stage did not complete; claim no normal lifecycle. |
| `repository_snapshot_failed` | Repository state cannot be safely compared; fail closed. |
| `unmanaged_change_detected` | Changes outside verified permits remain; do not present a managed result. |
| `telemetry_recording_failed` | Required event transaction failed; do not start or stop execution. |
| `contract_validation_failed` | Common coordinates differ; reject the affected stage. |

Persist only SHA-256 digests for request, result, and diagnostics. Paths are repository-relative. Raw context, tasks, results, output, and provider errors remain out of events.

## Consequences

- Both providers pass one lifecycle fixture and start turns only after injection.
- Provider changes cannot be promoted to verified `file.changed` from capability reports alone.
- Coordinator, gate, monitor, contracts, failures, and snapshots can evolve independently.
- ADR-0012 adds result artifacts; ADR-0013 adds the managed per-path write bridge while retaining unmanaged-change detection.
