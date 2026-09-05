# ADR-0374: Project operating liveness without health inference

- Status: accepted
- Date: 2026-09-05

## Context

Root-agent heartbeats and managed-provider process observations have separate canonical meanings. A heartbeat proves one accepted report for one agent revision; a process observation proves one adapter-backed process state at one instant. Neither provides an installed product host with a repository-wide operating view. Combining them into inferred health would invent continuity, process ownership, or release authority.

Single-agent inspection is not an operating contract. Requiring hosts to scan events or import workspace-private packages would expose storage details and duplicate validation and projection policy. Adding liveness to the HTML board would couple evidence semantics to one presentation.

## Decision

Add the provider-neutral `OperatingLivenessReportV1` application contract. `lervo application liveness --json` reads the current root-agent registry, validates the complete canonical stream of `agent.liveness.observed` and `provider.process.observed` events, and returns two independent collections:

- Every root agent with its existing `inactive`, `unobserved`, `agent_revision_changed`, `recently_observed`, or `stale_observation` projection.
- The latest recorded point-in-time process observation for each opaque provider-session digest, preserving `running`, `exited`, or `unobservable` and its exact evidence kind.

The report does not correlate root-agent and managed-provider session digests. Every provider-process item is labeled `point_in_time_only`, declares false authority and progress effects, and states that event age or silence proves no current process state. Process detail is newest-first and limited to 256 items, with exact total and truncated counts visible. The workforce registry contract bounds root-agent cardinality.

Responsibilities remain separate:

- `@lervo/application-contract`: public report shape.
- `@lervo/agent-workforce`: heartbeat thresholds and status decisions.
- CLI event source: canonical paging and event validation.
- Pure projector: ordering, summaries, truncation, digesting, and non-authority fields.
- Repository inspection: storage composition.
- Formatting: human text.
- Application command: parsing and dispatch only.

Add `operating_liveness.inspect` only to explicit product-host protocol version 3. Default version 1 and explicit version 2 remain byte-compatible discovery contracts. The route is read-only, needs no Hub, and has no UI, polling, scheduler, provider control, recovery, or lease-release effect.

## Privacy and failure meaning

The report may expose Lervo event, run, session, sequence, adapter, agent, and domain-separated provider-session digest coordinates. It excludes raw provider-session identifiers, PIDs, commands, prompts, outputs, paths, credentials, and unrestricted errors.

Any malformed liveness or provider-process event fails the query rather than being omitted. Invalid stale thresholds fail even with no root agents. `unobservable` remains an explicit transport capability gap; `exited` remains a point-in-time observation. Missing events, stale observations, truncation, and silence never become an empty-health success or authorize mutation.

## Consequences

- Installed product hosts can observe repository-wide liveness evidence without private packages or storage internals.
- Root-agent and managed-process evidence remain independently extensible and testable.
- A later UI can consume the contract without owning its policy.
- Direct-message acknowledgment, trigger delivery, unattended scheduling, native resume, and automatic recovery remain separate outcomes.

## Verification

Focused tests cover every root-agent status, child exclusion, explicit unobservable process evidence, point-in-time semantics, false authority fields, invalid empty-registry thresholds, bounded process detail, complete counts, application dispatch, and protocol-v3 discovery.

CLI integration validates and projects both v2 event families. The packed external consumer activates the v2 writer, records a root heartbeat, discovers protocol v3, and queries the installed report without a Hub, provider, private package, or UI.

## References

- [Root-agent liveness](../orchestration/0371-observe-root-agent-liveness-without-process-authority.md)
- [Managed provider process state](../orchestration/0372-observe-managed-provider-process-state-through-adapters.md)
- [Operating liveness](../../../specifications/execution/operating-liveness.md)
- [Product-host protocol](../../../specifications/execution/product-host-protocol.md)
