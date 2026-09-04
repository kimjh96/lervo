# Product outcome convergence

Status: `active`

As of: 2026-09-05

## Outcome

Close the gap between the Lervo direction derived from Paperclip, Buzz, Prime Agent, and Hermes and the user scenarios the installed product completes. A source file, unit test, green CI run, or narrowly completed roadmap slice does not establish a broader product claim.

A capability is complete only when its named user scenario runs through the installed boundary, preserves authority and evidence meanings, and has a regression test at that boundary.

Table states: `implemented` means the exact scenario is evidenced; `partial` means useful primitives exist but the stated outcome does not complete; `missing` means no installed route owns the outcome; `external product` means Lervo supplies primitives while a separate host owns the interface.

## Acceptance baseline

Baseline revision: `7404d7d985d52014b12326571cf9743092103f54`

The reviewed release is `v0.11.4` at `6a004be19d831d3616e75ea109c95eb8360a5da5`. Post-release reconciliation confirmed current reviewed-document state in arca-next and Shiflo, retired seven stale metadata-only canonicalization candidates whose responsibilities current canonical sources already cover, and restored a clean Lervo operating-attention projection. See [v0.11.4 post-release state reconciliation](../evidence/quality/v0.11.4-post-release-state-reconciliation.md).

### Repository knowledge and Hermes-derived outcomes

| User outcome | Current evidence | State | Completion proof still required |
| --- | --- | --- | --- |
| A natural-language repository request receives relevant current documents. | Direct hooks project bounded queries, select registered sources, and load exact hashes; managed delivery uses the same evidence distinctions. | implemented | Keep cross-provider retrieval and exact-load regression evidence current. |
| Retrieval distinguishes recommendation, selection, loading, injection, reference, and semantic use. | Event and context contracts retain these distinct states and mark direct-provider use unknown. | implemented | No broader claim is permitted. |
| Capabilities and tool schemas are progressively discovered and activated. | Managed execution has capability recommendation, dependency, permission, activation, and invocation contracts. Direct terminal retrieval neither selects tools nor grants authority. | partial | An installed scenario must discover only relevant capability schemas, activate with exact authority, invoke, and record separate evidence states. |
| Work continues across agents, providers, sessions, devices, and clean clones. | Workstreams, canonical sources, Hub replication, handoffs, and workspace checkpoints preserve bounded continuation. Provider sessions are replaceable and not generally resumed. | partial | Fresh-session and cross-provider acceptance must resume the same bounded work without claiming native provider-session resume. |
| A repository-changing result becomes durable knowledge in its responsible canonical source. | Final declaration binds every changed noncanonical source to exact changed canonical targets, a reviewable no-durable-change rationale, or a local proposed Markdown draft. The packed installed journey prepares a turn, records and surfaces a draft, writes its authorized target, promotes against exact candidate and target hashes, and removes the resolved attention item. | implemented | Distinguish agent proposal, user authority, exact promotion, and canonical truth; infer neither semantic correctness nor model understanding. |
| Items requiring human authority surface when the user can act. | Protocol-v2 `operating_attention.inspect` aggregates current authority and maintenance. Direct prompt preparation includes its bounded current/cache-backed form without another model call or full lifecycle rescan. Focused and packed installed-consumer acceptance pass. | implemented | Preserve source-coverage degradation, action-owner distinctions, and preparation-not-receipt semantics. |
| Repeated work becomes a reviewed reusable pattern whose later effect can be observed. | Pattern proposal, review, promotion, and two bounded local metrics exist. Proposal and promotion are explicit; attribution remains unestablished. | partial | A completed result must be able to create a source-bound candidate through finalization, followed by an installed review-to-effect journey. |
| A selected source becomes a reviewed portable skill. | Skill migration and capability packaging exist; no source-to-skill candidate route connects selected source evidence to review and activation. | missing | Pass an exact source-hash candidate, permission/resource review, activation, invocation, stale-source, and rollback journey. |

### Prime-Agent-derived execution outcomes

| User outcome | Current evidence | State | Completion proof still required |
| --- | --- | --- | --- |
| Bounded work is a graph; one attempt is governed by verification, retry, resource, approval, and completion policy. | Assignment DAG projection, pure controller decisions, manual `loop run`, managed attempts, verification, leases, and completion reconciliation exist. | implemented | Preserve the installed manual journey and its non-autonomy claim. |
| Root agents and recursive workers retain identity, ancestry, authority, path-conflict protection, and evidence. | Workforce and isolated-workspace contracts cover parent identity, delegation depth, leases, path scope, sealing, integration, and handoff. | implemented | Keep root and subagent contract tests common. |
| A long-running agent can attach, detach, and resume. | Worker Stop records an exact scoped checkpoint, pauses and releases its writer, and permits a fresh verified terminal session to resume the same assignment. Codex and Claude still report native `sessionResume: unsupported`; conversation memory is not restored. | partial | Add adapter-specific native resume only when independently evidenced; retain repository-level continuation as the portable fallback. |
| A repository goal has a durable lifecycle instead of disconnected prose. | The verified workstream remains root-goal authority; its assignment DAG remains execution authority. `loop goal` and protocol-v2 `operating_goal.inspect` compose explicit status, hierarchy, progress, blocking, completion readiness, and inconsistency without a second store or provider start. | implemented | Preserve explicit workstream completion and false authority flags. Independent nested goals, dynamic topology, and unattended scheduling remain separate unsupported capabilities. |
| Runtime liveness is observable through heartbeats. | Direct worker writers record bounded last-seen observations; `workspace inspect` distinguishes recent, stale, legacy, and absent without releasing authority. Assignment leases and deliberation workers retain narrower heartbeats. | partial | Extend these evidence semantics to root agents and managed provider processes. Silence must mean observation staleness, not termination proof. |
| Bounded autonomous continuation runs without repeated manual triggers. | The governed loop is deliberately manual; the product-host protocol declares unattended scheduling unsupported. | missing | Before accepting an unattended journey, a reviewed scheduler must bind current checkpoints, budgets, leases, retry limits, cancellation, uncertain effects, escalation, and a kill switch. |
| Agents communicate directly while preserving authority. | Mentions, handoffs, assignment threads, inbox projections, and connector delivery exist. Delivery and acknowledgment remain unobserved unless a connector proves them; no live general agent-message session exists. | partial | Prove a message-to-assignment or message-to-handoff journey keeping delivery, acknowledgment, authority, and action separate. |
| Runtime lessons become reviewable instruction, skill, or profile candidates. | Durable-instruction and development-pattern domain code exists; direct terminal intake is intentionally disabled, and no agent-profile candidate path exists. | partial | Route outcome evidence to the correct candidate type; require exact review, activation, effect observation, supersession, and rollback. |

### Paperclip-, Buzz-, loop-, graph-, and host-product outcomes

| User outcome | Current evidence | State | Completion proof still required |
| --- | --- | --- | --- |
| An operator sees objectives, agents, assignments, dependencies, blockers, approvals, verification, and observed budgets together. | The static board covers the graph; protocol-v2 attention covers current authority and knowledge maintenance through installed read-only routes. These remain separate projections, not one interactive screen. | partial | A separate product host must compose both reports into one operating view without acquiring repository authority. |
| Repeatable work is triggered safely. | Exact assignment routines materialize from one manual trigger. Cron, webhook, API, approval-resolution, and assignment wakeups are not installed. | partial | Add each trigger behind a versioned adapter and shared idempotency, authority, budget, and recovery contracts. |
| Slack receives a governed assignment artifact. | A production outbound adapter keeps credentials and native destinations private, reserves durably before effect, and distinguishes delivered, rejected, and unknown. | implemented | Live-workspace authorization remains an external exercise; inbound Slack and acknowledgment are separate capabilities. |
| Paperclip-like and Buzz-like complete interfaces are built into Lervo. | Lervo intentionally exposes a headless kernel, static reference surface, and connector ports instead of another task or chat database. | external product | A separate product may supply UI and product-owned presentation state through the versioned host boundary without becoming repository authority. |
| A separately installed host composes Lervo without private workspace imports. | Default protocol v1 retains 21 routes; explicit v2 adds operating attention and the composed repository goal for 23 routes. The real packed consumer passes against both versions without workspace-private imports. | implemented | Future route changes require the same reviewed protocol and packed compatibility proof. |
| Execution graphs support bounded dynamic branches, joins, and reviewed topology changes. | Assignment dependencies form an acyclic rebuildable DAG; routines materialize fixed reviewed templates. Dynamic mutation and arbitrary cycles are unsupported. | partial | Introduce a new versioned graph contract only with topology authority, cycle bounds, migration, recovery, and historical replay. |
| Models, providers, harnesses, retrieval methods, tools, skills, protocols, and UIs remain replaceable. | Core authority and evidence use provider-neutral contracts; Codex, Claude, search, connector, host, and execution-target behavior enter through adapters. | implemented | Every new edge must retain common conformance, explicit capability degradation, migration, rollback, and local-without-Hub acceptance. |

### Foundation outcomes that remain open

| User outcome | Current observation | State | Completion proof still required |
| --- | --- | --- | --- |
| The user sees how many tokens one requested task consumed. | Managed runs can report scope-bound resource observations. Direct terminal coverage reports a complete duration tree and separate query-projection usage. Whole-task usage remains `unsupported: unmanaged_provider_usage_unobserved`; provider-turn tokens, cached input, and resource counters are not attributed to every stage. | partial | Bind provider-turn usage to the direct turn when observable; expose stage-scoped time, token, and cache evidence. Otherwise keep usage explicitly unsupported. Never add projection usage to an unobserved task total. |
| Terminal hooks meet reviewed latency budgets. | The retained prior cohort reports Codex Prompt p95 17,122.791 ms against 15,000 ms and Stop p95 16,820.386 ms against 5,000 ms. The current environment profile reports Prompt p95 11,092.791 ms from seven samples and Stop p95 1,768.014 ms from five; both remain `sample_population_insufficient` against the unchanged 30-sample minimum. | partial | Reach 30 samples for both hooks in one current build and environment profile; pass latency gates without deleting historical failures. Configured cost or latency exhaustion must fail closed at the owning boundary. |

## Corrected claim boundaries

- The completed natural-language terminal v1 flow verifies retrieval, workstream checkpoints, declarations, and lifecycle inspection. It provides neither automatic semantic outcome drafting nor proactive user attention.
- The completed branch-safe lifecycle verifies typed candidate creation and exact review. ADR-0327 superseded its older direct durable-rule materialization statement; no installed direct or explicit consumer currently calls the materializer.
- The completed governed-loop roadmap covers manual v1 and a read-only workstream-goal projection. It does not cover Prime-Agent-style unattended continuation, native provider-session resume, root-process heartbeat, independent goal mutation, or dynamic topology.
- The completed product-host protocol is a CLI compatibility boundary, not a Paperclip or Buzz product interface.
- A successful full repository check proves encoded contracts; it cannot prove a user outcome absent from them.

## Remaining delivery order

1. Strengthen terminal observation: complete one 30-sample current-build cohort for both hooks; settle observable and unsupported request-scoped token-usage boundaries; expose stage-scoped time, token, and cache evidence; fail closed when the owning cost or latency budget is exhausted.
2. Complete source-to-skill and reviewable instruction or profile candidate journeys with exact review, activation, effect observation, supersession, and rollback.
3. Extend repository continuation only through separately evidenced native provider resume, root-agent and managed-process liveness, direct-message acknowledgment, and reviewed trigger adapters.
4. Add unattended scheduling or dynamic graph topology only after authority, budget, cancellation, uncertain-effect, migration, recovery, and kill-switch contracts pass installed acceptance.
5. Version further product-host routes only with packed external-consumer proof; keep Paperclip-like and Buzz-like interfaces in separate hosts.

The earlier sequence through attention, durable terminal outcomes, checkpointed workspace continuation, product-host protocol v2, release-impact repair, CLI README normalization, and the final `v0.11.4` release gate is complete. Post-release maintenance does not reopen those acceptance results.

## References

- [Product positioning and verified improvement](../research/lervo-product-positioning-and-verified-improvement.md)
- [Agent platform and evolution](../research/lervo-agent-platform-evolution.md)
- [Foundation hardening](foundation-hardening.md)
- [Governed loop and assignment graph](governed-loop-assignment-graph.md)
- [Product-host protocol](../specifications/execution/product-host-protocol.md)
- [Repository knowledge lifecycle convergence](../specs/repository-knowledge-lifecycle-convergence.md)
- [Availability-safe unmanaged terminal hooks](../decisions/execution/providers/hooks/0327-availability-safe-unmanaged-terminal-hooks.md)
