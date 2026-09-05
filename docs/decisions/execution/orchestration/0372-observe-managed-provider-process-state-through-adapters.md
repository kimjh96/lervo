# ADR-0372: Observe managed provider process state through adapters

- Status: accepted
- Date: 2026-09-05

## Context

Root-agent reports, workspace-writer last-seen state, assignment leases, connector acknowledgements, and provider events have distinct meanings. None proves the current native-process state of a provider transport launched by Lervo. Treating retained adapter sessions or recent provider events as process liveness would invent telemetry; exposing native process identifiers would widen the privacy surface.

Transport capabilities differ:

- The Codex app-server client owns a child process and can inspect its exit state.
- The Codex Responses no-tool transport owns an HTTP request, not a provider process.
- The Claude Agent SDK owns its subprocess internally but exposes no authenticated process-state inspection contract.

## Decision

Every `ProviderAdapter` must implement synchronous, read-only `inspectProcess(session)`. Results bind to the exact adapter, project, run, Lervo session, and provider session. Allowed state/evidence pairs are:

| State | Evidence kind | Condition |
| --- | --- | --- |
| `running` or `exited` | `owned_process_state` | The adapter's transport directly owns and inspects the native process. |
| `unobservable` | `transport_state_unavailable` | The selected client does not expose process state. |
| `unobservable` | `no_managed_process` | The selected transport does not launch a provider process. |

Codex stdio implements owned-process inspection. Codex Responses reports `no_managed_process`; Claude Agent SDK reports `transport_state_unavailable`. Adapters must not infer process state from session registration, event recency, model output, connector delivery, or root-agent heartbeats.

Managed execution records `provider.process.observed` after session start, after each terminal turn signal, and immediately before shutdown after stream drainage. Its event-envelope-v2 payload contains adapter identity, a domain-separated provider session digest, phase, state, evidence kind, observation time, and fixed false authority/progress flags. It excludes the raw provider session, PID, command, prompt, output, path, credential, and unrestricted error.

Malformed or mismatched observation coordinates are `contract_validation_failed`; redaction or event commit failure is `telemetry_recording_failed`. Either fails the managed run while still attempting ordinary adapter shutdown.

`exited` is evidence at one instant; `unobservable` is an explicit capability gap. Silence, age, absence, and either state release no agent, assignment, workspace-writer, or completion authority.

## Consequences

- Native state stays behind provider adapters; orchestration consumes one provider-neutral contract.
- Managed traces distinguish directly observed process state from transport gaps without exposing raw process coordinates.
- Observation recording adds no polling loop, scheduler, process controller, mutable liveness store, or claim of continued health.
- Root-agent liveness, provider-process state, workspace-writer liveness, assignment leases, connector acknowledgement, and trigger delivery remain independently reviewable.

## Verification

- Schema and redaction tests enforce the v2-only payload, state/evidence discriminator, fixed false claims, and raw-runtime exclusion.
- Common adapter contract tests enforce exact session binding.
- Codex stdio, Codex Responses, and Claude SDK tests cover their distinct native boundaries.
- Managed-run tests cover start, terminal, and pre-stop observations, process-session hashing, event order, and fail-closed coordinate mismatch with adapter shutdown.
