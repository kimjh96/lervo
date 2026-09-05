# Managed provider process observations

Status: `active`

As of: 2026-09-05

`provider.process.observed` is a version-2 managed-execution event. It records one adapter-backed
point-in-time observation and never acts as an agent heartbeat, assignment lease, connector
acknowledgement, or completion decision.

## Payload

| Field                         | Meaning                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------ |
| `adapterId`                   | Exact managed adapter identity.                                                |
| `providerSessionDigest`       | Domain-separated SHA-256 digest of adapter and provider-session coordinates.   |
| `phase`                       | `session_started`, `turn_terminal`, or `before_stop`.                          |
| `status`                      | `running`, `exited`, or `unobservable`.                                        |
| `evidence`                    | `owned_process_state`, `transport_state_unavailable`, or `no_managed_process`. |
| `observedAt`                  | Instant at which the adapter inspected its transport.                          |
| `releasesAgentAuthority`      | Always `false`.                                                                |
| `releasesAssignmentAuthority` | Always `false`.                                                                |
| `provesWorkProgress`          | Always `false`.                                                                |

`running` and `exited` require `owned_process_state`. `unobservable` requires one of the explicit gap
reasons. The event excludes raw provider-session IDs, native process identifiers, commands, prompts,
outputs, paths, credentials, and unrestricted errors.

## Failure meaning

An invalid or cross-session adapter result fails managed execution as `contract_validation_failed`.
Failure to sanitize or atomically append the event is `telemetry_recording_failed`. Shutdown is still
attempted. Missing later observations, elapsed time, or an `unobservable` result never implies process
exit and never releases authority. See
[ADR-0372](../../../decisions/execution/orchestration/0372-observe-managed-provider-process-state-through-adapters.md).
