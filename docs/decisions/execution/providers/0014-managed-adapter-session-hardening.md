# ADR-0014: Managed adapter session hardening

Status: `accepted`  
Decision date: 2026-08-19

## Context

The one-file managed-write slice left three gaps: providers could request tools before `startTurn` returned a provider turn ID; descriptor maxima could make read-only sessions appear write-capable; and failed shutdown could retain session state and provider result source. Provider approval and one-file policy were also too tightly coupled to adapter lifecycle.

## Decision

### Turn acceptance and effective capabilities

- `ProviderAdapter.startTurn` receives a synchronous `accepted(turn)` callback. The adapter must call it with a schema-valid turn before using tools. The orchestrator validates session, target-turn, and provider-turn coordinates before exposing the turn.
- Missing, duplicate, or return-value-mismatched callbacks produce `contract_validation_failed`.
- `AdapterSession` requires `executionMode` and `effectiveCapabilities`. Descriptor capabilities are implementation maxima; session capabilities reflect current permissions, sandbox, and tools.
- Sessions cannot widen descriptor support. Read-only sessions cannot report supported file changes; managed-write sessions must support them.
- `adapter.started` records session `effectiveCapabilities`, containing only machine capability states. Missing, invalid, widened, or mode-inconsistent values produce `contract_validation_failed`.

### Write plan and provider boundaries

- The orchestrator builds one `ManagedWritePlan` and passes it to the bridge. It defines mode, normalized allowed paths, minimum and maximum verified changes, and post-change context disposition.
- Read-only plans allow `0..0`; managed-write plans require `1..1`. Both invalidate context after a change. Future multi-file policy may replace plan generation without adapter changes.
- Codex and Claude keep approval state and provider-message parsing in provider-specific `ManagedWriteController` implementations. Claude Pre/PostToolUse plumbing remains in a hook module. Adapter cores own only session, context, turn, event, and shutdown order.
- The common adapter contract suite validates all managed-write message schemas, coordinates, and times.
- Missing or failed completion, duplicates, disallowed paths, and actual change-kind mismatches fail in phase `provider_write`. Failure precedence is telemetry, artifact, provider stop, provider write, then unmanaged change; the complete related list retains every fact.

### Shutdown and source lifetime

- Stop attempts interrupt, unsubscribe, and provider close, then always clears injected/start turn IDs, pending approvals, result source, active-turn references, registry state, and the session entry.
- Later use returns `session_not_found`.
- If provider close fails, return `provider_process_failed` only after local cleanup; the orchestrator maps it to `provider_stop_failed`.
- Retain result source only while validating and storing it in CAS, then remove it during shutdown. Stop results and errors gain no personal-data fields.
- Direct, unobservable provider work remains `unmanaged` and never crosses this boundary.

## Consequences

- Tool requests bind to an orchestrator-validated turn.
- Traces describe current session capabilities rather than theoretical adapter support.
- Failed shutdown cannot leave reusable approvals or result source.
- Write-count policy, provider protocol, and session lifecycle can evolve independently.
- Public package exports remain stable while schemas separate into session/context, managed-write, provider-observation, and raw-protocol modules.
