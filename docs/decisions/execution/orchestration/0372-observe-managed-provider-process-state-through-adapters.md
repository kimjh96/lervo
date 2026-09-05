# ADR-0372: Observe managed provider process state through adapters

- Status: accepted
- Date: 2026-09-05

## Context

Root-agent reports, workspace-writer last-seen state, assignment leases, connector acknowledgements,
and provider events have distinct meanings. None proves the current native-process state of a provider
transport that Lervo launched. Treating a retained adapter session or recent provider event as process
liveness would invent telemetry, while exposing native process identifiers would widen the privacy
surface.

Provider transports also differ. The Codex app-server client owns a child process and can inspect its
exit state. The Codex Responses no-tool transport owns an HTTP request rather than a provider process.
The Claude Agent SDK owns its subprocess internally but does not expose an authenticated process-state
inspection contract.

## Decision

Require every `ProviderAdapter` to implement the synchronous, read-only `inspectProcess(session)`
contract. The result is bound to the exact adapter, project, run, Lervo session, and provider session.
Its state is one of:

- `running` or `exited` with `owned_process_state`, only when the adapter's transport directly owns and
  inspects the native process;
- `unobservable` with `transport_state_unavailable` when the selected client does not expose process
  state; or
- `unobservable` with `no_managed_process` when the selected transport does not launch a provider
  process.

The Codex stdio client implements owned-process inspection. Codex Responses reports
`no_managed_process`; Claude Agent SDK reports `transport_state_unavailable`. An adapter must not infer
process state from session registration, event recency, model output, connector delivery, or root-agent
heartbeats.

Managed execution records `provider.process.observed` after session start, after each terminal turn
signal, and immediately before shutdown after stream drainage. This is an event-envelope-v2 payload containing adapter identity, a domain-separated provider
session digest, phase, state, evidence kind, observation time, and fixed false authority/progress flags.
It excludes the raw provider session, PID, command, prompt, output, path, credential, and unrestricted
error.

Malformed or mismatched observation coordinates are `contract_validation_failed`; redaction or event
commit failure is `telemetry_recording_failed`. Either fails the managed run and still attempts ordinary
adapter shutdown. `exited` is evidence at one instant, and `unobservable` is an explicit capability gap.
Silence, age, absence, and either state release no agent, assignment, workspace-writer, or completion
authority.

## Consequences

- Native state remains behind provider adapters while orchestration consumes one provider-neutral
  contract.
- Managed traces distinguish directly observed process state from transport gaps without exposing raw
  process coordinates.
- Observation recording does not add a polling loop, scheduler, process controller, mutable liveness
  store, or a claim of continued health.
- Root-agent liveness, provider-process state, workspace-writer liveness, assignment leases, connector
  acknowledgement, and trigger delivery remain independently reviewable.

## Verification

Schema and redaction tests enforce the v2-only payload, state/evidence discriminator, fixed false claims,
and raw-runtime exclusion. Common adapter contract tests enforce exact session binding. Codex stdio,
Codex Responses, and Claude SDK tests cover their distinct native boundaries. Managed-run tests cover
start, terminal, and pre-stop observations, process-session hashing, event order, and fail-closed coordinate
mismatch with adapter shutdown.
