# ADR-0008: Managed context-gate orchestration

Status: `accepted`
Decision date: 2026-08-18

## Context

Context preparation produces E1/E2 and delivery produces verified E3, but an execution owner must commit that evidence and evaluate one gate before the first file write. Caller-assembled evidence could open capabilities before telemetry commits, override a role denial with E3, or reuse stale receipts after compaction or source changes.

## Decision

### Ownership and state

- Provider-neutral `@lervo/orchestrator` owns managed context state: `awaiting_context`, `context_prepared`, `context_injected`, and `write_authorized`.
- Serialize prepare, inject, and write authorization per run. Adapter compaction/restart signals may invalidate generation while injection is in progress.
- Required telemetry or redaction failure moves the object permanently to `telemetry_failed`; it cannot issue another permit.
- Provider processes and provider-specific invalidation signals remain adapter responsibilities.

### Atomic telemetry

- Append all E1 `context.selected` and E2 `document.loaded` events in one transaction, retaining an E1 event per selection reason.
- After verified E3, record aggregate receipt coordinates in `context.injected`.
- Record each `capability.requested/decided`, `file.changed/context.invalidated`, and reason-grouped snapshot invalidation in its own transaction.
- Advance in-memory evidence and phase only after commit. Append, schema, redaction, or storage failure rolls back, increments generation, and invalidates pending E3 and permits.

### One-use write permits

- Evaluate the current project/run/session, generation, required document IDs/hashes/scopes, and E1/E2/E3 through `evaluateWriteContext`.
- Issue a permit only when the role allows `filesystem.write` and every required document has E3. `deny` always rejects. `require_approval` returns without a permit until a verified approval lifecycle exists.
- Bind each one-use permit to the capability decision event, generation, normalized target path, target digest, and actual before-hash at authorization.
- A changed path or generation cannot be reported as a managed change.
- Safely reread the file after mutation and verify the actual after-hash. A before/after mismatch causes `file_change_unverified`, invalidates generation, and emits no managed-change event.

### Invalidation

- Revalidate file and publication snapshots immediately before writing. Record specific `context.invalidated` events by reason and increment generation once.
- Add orchestration reasons `managed_file_changed`, `file_change_unverified`, `context_compacted`, `session_restarted`, and `snapshot_validation_failed`.
- An invalidation event names the old generation. After commit, increment generation and return to `awaiting_context`.
- Reusing a logical session after process restart requires the runtime to provide an increased initial generation; the M3 adapter links restart signals to the new provider session.

### Failure semantics and privacy

| Situation | Meaning |
| --- | --- |
| E1/E2/E3 or capability telemetry failure | `telemetry_recording_failed`; roll back, increment generation, block writes. |
| Missing/mismatched/stale E3 | `required_context_missing`; block until new preparation and injection. |
| `filesystem.write=deny` | `capability_denied`; no permit regardless of E3. |
| `filesystem.write=require_approval` | `approval_required`; no permit before a verified approval lifecycle. |
| Invalid coordinates, times, paths, hashes, or transitions | `contract_validation_failed`; reject before event or change recording. |

Events contain only reasons, IDs, relative paths, hashes, byte counts, scopes, source revisions, receipts, and generation coordinates. They exclude source bodies, inline/CAS bytes, prompts, provider payloads, and credentials.

If telemetry fails after a file has already changed, do not claim rollback. Fail closed and let later unmanaged-change detection evaluate filesystem state independently.

## Consequences

- Event-store commit and capability state advance in the same order.
- E3 cannot bypass role policy or authorize another target.
- Stale generations cannot write after source changes, compaction, restart, or telemetry failure.
- Provider adapters implement execution and signals without duplicating common gate semantics.
