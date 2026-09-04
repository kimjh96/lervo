# ADR-0336: Adopt a headless governed loop over the assignment graph

- Status: `accepted`
- Decision date: 2026-09-02

## Context

FH0 through FH5 established compatible event readers, causal managed work, provider resource accounting, stage timing, recovery, security, capacity bounds, and aggregate readiness. Lervo had assignment dependencies and cancellation planning, but no single public projection could tell an operating product whether to claim, run, retry, wait, block, escalate, or complete work. A scheduler database or UI-owned graph would duplicate assignment and event authority.

Ordinary managed workforce runs recorded the current workstream but omitted the assignment and agent from their root causal payload, preventing an event-derived controller from relating attempts to assignment nodes without inference.

## Decision

Create `@lervo/application-contract` as the provider-neutral, storage-free v1 boundary for work graphs, attempt and resource observations, loop policy, decisions, and headless query and command types. Create `@lervo/work-controller` with only its first pure projection implementation. It consumes assignment snapshots and validated canonical events but performs no storage, provider, clock, approval, or scheduling effects.

The graph is the current workstream's assignment DAG. Nodes retain opaque assignment, role, dependency, lease, and approval-digest coordinates. The projector reports roots, joins, duplicate or escaping dependencies, cycles, and attempt counts. Graph identity and hash bind the exact projection but grant no execution authority.

The loop decision is rebuilt from current assignment state, causal root and retry events, run terminal events, verification status, and resource observations. It may recommend claim, start, retry, approval wait, dependency wait, cancellation propagation, block, escalation, or completion. It never mutates an assignment or appends an event.

Managed application execution accepts an internal causal-attempt coordinate only when its workstream, assignment, and agent exactly match the verified current workstream and active workforce lease. Ordinary workforce runs bind those coordinates in their root causal event. The loop adapter defers existing immediate assignment finalization, invokes the unchanged managed-run port, and finalizes through the existing workforce transition only after functional verification and writing publication pass.

Retry ancestry remains an existing v2 `work.causality.recorded` relationship. A retry points to the latest failed attempt in the same work and increments its ordinal by one. The orchestrator revalidates ancestry before provider startup. At most 16 attempts and 32 parallel assignments are allowed; in-progress attempts consume that capacity before new claim, start, or retry actions are admitted. Execution is manually triggered; no daemon, heartbeat scheduler, or unattended continuation is introduced.

An attempt for an assignment absent from the current graph invalidates the projection. Provider-reported resource evidence must belong to a projected attempt and match that run's `adapter.started` provider. Foreign or differently attributed evidence cannot influence admission.

Resource admission thresholds bind the provider and exact accounting-descriptor hash. The controller never combines unlike providers or descriptors. When a threshold is configured, absent, partial, or invalid evidence follows the explicit `block` or `escalate` policy; it is not treated as zero. Reaching the observed threshold prevents another attempt but neither reserves nor caps a concurrent provider call. A provider-reported counter is neither normalized cross-provider cost nor billed money.

Approval requirements leave the projection only as hashes. The pure controller may consume verified approval observations from an authority adapter, but the initial CLI provides none and cannot turn a command-line claim into approval. Cancellation propagation remains a pure existing-state decision. This change adds no event type, redefines no v1 event, and creates no durable loop or graph state.

Local `lervo loop status` reads the shared report. `lervo loop run` executes only a currently recommended start or retry action under the exact active lease. Future local clients, Paperclip-like operating products, and Buzz-like collaboration products must use the same application boundary rather than storage internals.

## Privacy and failure meaning

The application report excludes task instructions, acceptance prose, repository paths, prompts, outputs, reasoning, credentials, provider configuration, and approval text. Task type and role IDs are bounded operating metadata; approval requirements appear only as digests. The CLI may locally display opaque event, graph, assignment, lease, and accounting coordinates.

An invalid graph produces `graph_invalid`. Missing approval produces `approval_missing`. An active attempt produces `active_attempt`. Exhausted attempts, terminal assignment failure, unavailable configured resource evidence, and exhausted resources retain separate reasons. If a managed run completed but assignment finalization cannot be proven after interruption, the controller returns `completion_reconciliation_required` and neither reruns nor marks success.

## Consequences

Lervo gains a usable headless loop and graph slice without a second source of truth or provider-specific scheduler. Parallel branches and joins become visible through current assignments, while managed execution, verification, leases, and event causality retain their existing owners. Product interfaces can evolve independently.

The initial slice leaves approval execution, cancellation mutation, completed-run reconciliation, a local graphical client, dynamic topology, monetary budgets, and unattended scheduling for later decisions. These are explicit capability limits, not inferred behavior.

## References

- [Governed loop and assignment graph roadmap](../../../../roadmap/governed-loop-assignment-graph.md)
- [Foundation verification and enhancement handoff](../../../../roadmap/foundation-hardening/verification-and-handoff.md)
- [System architecture](../../../../architecture/system.md)
- [Execution events and privacy](../../../../specifications/execution/events-and-privacy.md)
