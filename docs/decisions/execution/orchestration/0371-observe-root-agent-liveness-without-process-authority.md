# ADR-0371: Observe root-agent liveness without process authority

- Status: accepted
- Date: 2026-09-05

## Context

Workspace writer sessions expose bounded last-seen observations; durable root-agent identities lack an equivalent runtime signal. `agent.updatedAt` cannot serve this purpose: hiring, role binding, and lifecycle transitions change identity and authority, not process observations. A second mutable heartbeat in the agent registry would couple independently changing identity and telemetry lifecycles.

Provider-process health is separate. A CLI invocation reports one session coordinate at one time; it cannot prove continued native-process health or that an unauthenticated caller is the named process.

## Decision

Add `agent.liveness.observed` as an event-envelope-v2 contract. `lervo agent heartbeat` accepts an exact active root-agent revision, a compatible reporting provider, and a provider session coordinate. It records only agent ID and revision, reporting provider, a domain-separated session digest, and observation time. Exclude the raw provider session, process identifier, command, prompt, output, path, credential, and unrestricted error.

Heartbeat recording mutates no agent or assignment state. `lervo agent inspect` rebuilds the latest status from canonical events and current agent identity. States are `unobserved`, `recently_observed`, `stale_observation`, `agent_revision_changed`, and `inactive`. A malformed matching event fails inspection rather than being ignored.

The projection always declares `releasesAgentAuthority: false` and `provesManagedProcessHealth: false`. Silence, age, agent revision changes, and inactive identities never release an assignment, agent, workspace writer, or provider process. Managed provider-process supervision requires a separate adapter-backed contract.

Version 1 remains the default event writer. Heartbeat recording requires an explicitly activated version 2 writer; otherwise, it records no event. This preserves reader-first compatibility without adding a type to the immutable v1 type catalog.

## Consequences

- Root-agent runtime reports are observable without granting telemetry identity or assignment authority.
- The agent registry retains durable identity and capability bindings. The append-only event chain remains history authority; inspection is a rebuildable projection.
- A heartbeat proves only that the CLI accepted one bounded report at its recorded time. It does not prove caller authentication, provider understanding, continued process health, or managed execution.
- Worker-writer liveness, root-agent reports, managed provider-process health, connector acknowledgment, and trigger delivery retain separate evidence and failure contracts.

## Verification

Pure tests cover raw-session exclusion, root/active/revision/provider validation, every projection state, and false authority claims. Schema and redaction tests enforce v2-only events and reject private runtime details. CLI tests explicitly activate v2, record and inspect a heartbeat, verify the agent actor and privacy-bounded payload, and prove that a stale revision appends no event.
