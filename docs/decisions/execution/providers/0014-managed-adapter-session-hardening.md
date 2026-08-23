# ADR-0014: Managed adapter session hardening

Status: `accepted`
Decision date: 2026-08-19

## Context

After the one-file managed-write slice, three gaps remained: a provider could request a tool before `startTurn` returned its provider turn ID; descriptor-level maximum capabilities could make a read-only session appear write-capable; and failed shutdown could leave session state and provider result source in memory. Provider approval logic and the one-file policy were also too entangled with adapter lifecycle.

## Decision

### Turn acceptance and effective capabilities

- `ProviderAdapter.startTurn` receives a synchronous `accepted(turn)` callback. The adapter calls it with a schema-valid turn before the provider can use tools. The orchestrator validates session, target-turn, and provider-turn coordinates before exposing the current turn.
- A missing, duplicate, or return-value-mismatched callback is `contract_validation_failed`.
- `AdapterSession` requires `executionMode` and `effectiveCapabilities`. Descriptor capabilities are implementation maxima; session capabilities are what current permissions, sandbox, and tools actually expose.
- A session cannot widen descriptor support. Read-only cannot report supported file changes; managed-write must support them.
- Record session `effectiveCapabilities` in `adapter.started`, not descriptor maxima. Invalid, missing, widened, or mode-inconsistent capabilities are `contract_validation_failed`. This field contains machine capability states only.

### Write plan and provider boundaries

- Build one `ManagedWritePlan` in the orchestrator and pass it to the bridge. It declares mode, normalized allowed paths, minimum/maximum verified changes, and post-change context disposition.
- Current read-only plans allow `0..0`; managed-write plans require `1..1`; both invalidate context after a change. Future multi-file policy can replace plan generation without adapter changes.
- Codex and Claude delegate approval state and provider-message parsing to their own `ManagedWriteController`; Claude Pre/PostToolUse plumbing also stays in a hook module. Adapter cores own only session, context, turn, event, and shutdown order.
- The common adapter contract suite validates all managed-write message schemas, coordinates, and times.
- Missing/failed completion, duplicates, disallowed paths, and actual change-kind mismatch fail in phase `provider_write`. Failure precedence is telemetry, artifact, provider stop, provider write, then unmanaged change; the full related list retains all facts.

### Shutdown and source lifetime

- Stop attempts interrupt, unsubscribe, and provider close, then always clears registry state: injected/start turn IDs, pending approvals, result source, active-turn references, and the session entry.
- Any later use returns `session_not_found`.
- If provider close fails, return `provider_process_failed` only after local cleanup; the orchestrator maps it to `provider_stop_failed`.
- Keep result source only while validating and storing it in CAS, then remove it at shutdown. Add no personal-data fields to stop results or errors.
- Direct, unobservable provider work never crosses this boundary and remains `unmanaged`.

## Consequences

- Tool requests bind to a turn already validated by the orchestrator.
- Trace capabilities describe the current session, not theoretical adapter support.
- Failed shutdown cannot leave reusable approvals or result source behind.
- Write-count policy, provider protocol, and session lifecycle can evolve independently.
- Public package exports remain stable while schemas are separated into session/context, managed-write, provider-observation, and raw-protocol modules.
