# Operating liveness

Status: `active`

As of: 2026-09-05

## Purpose

`lervo application liveness --json` exposes one read-only, provider-neutral operating report from canonical workforce identity and execution events. It is a query contract, not a UI or health controller.

## Report contract

`OperatingLivenessReportV1` contains:

- `schemaVersion: 1`, `kind: operating_liveness.report`, project and observation coordinates, and a deterministic report digest;
- `rootAgents`, sourced only from the root-agent registry and `agent.liveness.observed` events;
- `managedProviderProcesses`, sourced only from `provider.process.observed` events;
- separate status counts for both collections;
- fixed false authority and progress fields; and
- explicit limitations preventing cross-source health inference.

Root-agent items preserve agent ID, current revision and lifecycle status, configured provider, projected heartbeat state, latest observation coordinates, age, stale threshold, and the existing false `releasesAgentAuthority` and `provesManagedProcessHealth` claims. Child agents are excluded because their workspace-writer liveness has a different authority and lifecycle contract.

Managed-provider items preserve the Lervo event, sequence, run, session, adapter, provider, opaque provider-session digest, phase, state/evidence discriminator, and observation time. Every item declares `continuity: point_in_time_only`, `releasesAgentAuthority: false`, `releasesAssignmentAuthority: false`, and `provesWorkProgress: false`.

The managed collection selects the latest observation per opaque provider-session digest by observation time and event sequence, orders sessions newest-first, and returns at most 256 details. `totalCount` and `truncatedCount` describe the complete validated source result; summary status counts cover all latest sessions, including omitted details.

## State and evidence meaning

Root states remain:

| State | Meaning |
| --- | --- |
| `inactive` | The durable root identity is suspended or retired. |
| `unobserved` | No valid root heartbeat has been recorded. |
| `agent_revision_changed` | The latest heartbeat belongs to an older agent revision. |
| `recently_observed` | The current revision has a heartbeat within the selected threshold. |
| `stale_observation` | The current revision's latest heartbeat is older than the selected threshold. |

Managed process states remain:

| State | Required evidence | Meaning |
| --- | --- | --- |
| `running` | `owned_process_state` | The adapter directly observed its owned process running at `observedAt`. |
| `exited` | `owned_process_state` | The adapter directly observed its owned process exited at `observedAt`. |
| `unobservable` | `transport_state_unavailable` or `no_managed_process` | The transport cannot provide a managed native-process state. |

The two provider-session digests use different domains and are not join keys. A root heartbeat never proves managed-process health. A latest process observation never proves continuity after its observation time. Silence, age, `unobservable`, and `exited` release no agent, assignment, lease, workspace-writer, or provider authority.

## Failure, privacy, and effects

The stale threshold is an integer from 1,000 milliseconds through 24 hours and is validated even for an empty registry. A malformed matching event, missing provider actor on a process event, invalid event discriminator, storage failure, or workforce read failure fails the query. The projector does not turn unavailable or invalid input into an empty success.

Raw provider session IDs, native process IDs, commands, prompts, outputs, paths, credentials, and unrestricted errors are excluded. The route performs no repository write, polling, provider start or stop, recovery, scheduling, reassignment, or external effect.

## Product-host discovery

Explicit protocol-v3 discovery adds the `operating_liveness.inspect` route with result contract `operating_liveness_report` and command `application liveness --json`. Protocol v1 remains the default; protocol v2 remains unchanged.

## References

- [ADR-0374](../../decisions/execution/applications/0374-project-operating-liveness-without-health-inference.md)
- [Root-agent liveness](events-and-privacy/workforce-events/root-agent-liveness.md)
- [Managed provider process observations](events-and-privacy/provider-process-observations.md)
- [Product-host protocol](product-host-protocol.md)
