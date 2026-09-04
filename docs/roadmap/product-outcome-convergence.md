# Product outcome convergence

Status: `active`

As of: 2026-09-04

## Outcome

Close the difference between the Lervo direction derived from Paperclip, Buzz, Prime Agent, and Hermes and the user scenarios the installed product actually completes. A source file, unit test, green CI run, or narrowly completed roadmap slice is insufficient evidence for a broader product claim.

A capability is complete only when its named user scenario runs through the installed boundary, preserves authority and evidence meanings, and has a regression test at that boundary.

In the tables below, `implemented` means the exact scenario is evidenced; `partial` means useful primitives exist but the stated user outcome does not complete; `missing` means no installed route owns the outcome; and `external product` means Lervo supplies primitives while a separate host owns the interface.

## Acceptance baseline

Baseline revision: `7404d7d985d52014b12326571cf9743092103f54`

### Repository knowledge and Hermes-derived outcomes

| User outcome | Current evidence | State | Completion proof still required |
| --- | --- | --- | --- |
| A natural-language repository request receives relevant current documents. | Direct hooks project bounded queries, select registered sources, and load exact hashes; managed delivery uses the same evidence distinctions. | implemented | Keep cross-provider retrieval and exact-load regression evidence current. |
| Retrieval distinguishes recommendation, selection, loading, injection, reference, and semantic use. | Event and context contracts retain distinct states and mark direct-provider use unknown. | implemented | No broader claim is permitted. |
| Capabilities and tool schemas are progressively discovered and activated. | Capability recommendation, dependency, permission, activation, and invocation contracts exist for managed execution. Direct terminal retrieval does not select tools or grant authority. | partial | One installed scenario must discover only relevant capability schemas, activate with exact authority, invoke, and record separate evidence states. |
| Work continues across agents, providers, sessions, devices, and clean clones. | Workstreams, canonical sources, Hub replication, handoffs, and workspace checkpoints preserve bounded continuation. Provider sessions are replaceable and are not generally resumed. | partial | A fresh-session and cross-provider acceptance must resume the same bounded work without claiming native provider-session resume. |
| A repository-changing result becomes durable knowledge in the responsible canonical source. | Final declaration binds every changed noncanonical source to exact changed canonical targets, a reviewable no-durable-change rationale, or a local proposed Markdown draft. The packed installed journey prepares a turn, records and surfaces a draft, writes its authorized target, promotes against exact candidate and target hashes, and removes the resolved attention item. | implemented | Preserve the distinction between agent proposal, user authority, exact promotion, and canonical truth; no semantic correctness or model understanding is inferred. |
| Items requiring human authority are surfaced when the user can act. | Protocol-v2 `operating_attention.inspect` aggregates current authority and maintenance; direct prompt preparation includes its bounded current/cache-backed form without another model call or full lifecycle rescan. Focused and packed installed-consumer acceptance pass. | implemented | Preserve source-coverage degradation, action-owner distinctions, and preparation-not-receipt semantics. |
| Repeated work can become a reviewed reusable pattern and its later effect can be observed. | Pattern proposal, review, promotion, and two bounded local metrics exist; proposal and promotion are explicit operations and attribution remains unestablished. | partial | A completed work result must be able to create a source-bound candidate through the finalization flow, followed by an installed review-to-effect journey. |
| A selected source can become a reviewed portable skill. | Skill migration and capability packaging exist, but no source-to-skill candidate route connects selected source evidence to review and activation. | missing | One exact source-hash candidate, permission/resource review, activation, invocation, stale-source, and rollback journey must pass. |

### Prime-Agent-derived execution outcomes

| User outcome | Current evidence | State | Completion proof still required |
| --- | --- | --- | --- |
| Bounded work is represented as a graph and one attempt can be governed by verification, retry, resource, approval, and completion policy. | Assignment DAG projection, pure controller decisions, manual `loop run`, managed attempts, verification, leases, and completion reconciliation exist. | implemented | Preserve the installed manual journey and its non-autonomy claim. |
| Root agents and recursive workers retain identity, ancestry, authority, path-conflict protection, and evidence. | Workforce and isolated-workspace contracts cover parent identity, delegation depth, leases, path scope, sealing, integration, and handoff. | implemented | Keep root and subagent contract tests common. |
| A long-running agent can attach, detach, and resume. | A worker Stop records an exact scoped checkpoint, pauses and releases its writer, and permits a fresh verified terminal session to resume the same assignment. Codex and Claude still report native `sessionResume: unsupported`; conversation memory is not restored. | partial | Add adapter-specific native resume only when independently evidenced; repository-level continuation must remain the portable fallback. |
| One repository goal has a durable lifecycle rather than being disconnected prose. | The verified workstream remains root-goal authority and its assignment DAG remains execution authority. `loop goal` and protocol-v2 `operating_goal.inspect` compose explicit status, hierarchy, progress, blocking, completion readiness, and inconsistency without a second store or provider start. | implemented | Preserve explicit workstream completion and false authority flags; independent nested goals, dynamic topology, and unattended scheduling remain separate unsupported capabilities. |
| Runtime liveness is observable through heartbeats. | Direct worker writers record bounded last-seen observations, and `workspace inspect` distinguishes recent, stale, legacy, and absent without releasing authority. Assignment leases and deliberation workers retain their narrower heartbeats. | partial | Extend the same evidence semantics to root agents and managed provider processes; silence must remain observation staleness, not termination proof. |
| Bounded autonomous continuation can run without repeated manual triggers. | The governed loop is deliberately manual, and the product-host protocol declares unattended scheduling unsupported. | missing | A reviewed scheduler must bind current checkpoints, budgets, leases, retry limits, cancellation, uncertain effects, escalation, and a kill switch before one unattended journey is accepted. |
| Agents can communicate directly while preserving authority. | Mentions, handoffs, assignment threads, inbox projections, and connector delivery exist. Delivery and acknowledgment remain unobserved unless a connector proves them; there is no live general agent-message session. | partial | Prove a message-to-assignment or message-to-handoff journey with delivery, acknowledgment, authority, and action kept separate. |
| Runtime lessons become reviewable instruction, skill, or profile candidates. | Durable-instruction and development-pattern domain code exists, but direct terminal intake is intentionally disabled and no agent-profile candidate path exists. | partial | Route outcome evidence into the correct candidate type and require exact review, activation, effect observation, supersession, and rollback. |

### Paperclip-, Buzz-, loop-, graph-, and host-product outcomes

| User outcome | Current evidence | State | Completion proof still required |
| --- | --- | --- | --- |
| An operator can see objectives, agents, assignments, dependencies, blockers, approvals, verification, and observed budgets in one place. | The static board covers the graph, and protocol-v2 attention covers current authority and knowledge maintenance through installed read-only routes. They remain separate projections rather than one interactive product screen. | partial | A separate product host must compose both reports into one operating view without acquiring repository authority. |
| Repeatable work can be triggered safely. | Exact assignment routines materialize from one manual trigger. Cron, webhook, API, approval-resolution, and assignment wakeups are not installed. | partial | Add each trigger behind a versioned adapter and shared idempotency, authority, budget, and recovery contracts. |
| Slack can receive a governed assignment artifact. | A production outbound adapter keeps credentials and native destinations private, reserves durably before effect, and distinguishes delivered, rejected, and unknown. | implemented | Live-workspace authorization remains an external exercise; inbound Slack and acknowledgment are separate capabilities. |
| Paperclip-like and Buzz-like complete interfaces are built into Lervo. | Lervo intentionally exposes a headless kernel, static reference surface, and connector ports rather than another task or chat database. | external product | A separate product may supply UI and product-owned presentation state through the versioned host boundary without becoming repository authority. |
| A separately installed host can compose Lervo without private workspace imports. | Default protocol v1 retains 21 routes; explicit v2 appends operating attention and the composed repository goal for 23 routes. The real packed consumer passes against both versions without workspace-private imports. | implemented | Future route changes require the same reviewed protocol and packed compatibility proof. |
| Execution graphs support bounded dynamic branches, joins, and reviewed topology changes. | Current assignment dependencies form an acyclic rebuildable DAG; routines materialize fixed reviewed templates. Dynamic mutation and arbitrary cycles are unsupported. | partial | Introduce a new versioned graph contract only with topology authority, cycle bounds, migration, recovery, and historical replay. |
| Models, providers, harnesses, retrieval methods, tools, skills, protocols, and UIs remain replaceable. | Core authority and evidence sit behind provider-neutral contracts; Codex, Claude, search, connector, host, and execution-target behavior enter through adapters. | implemented | Every new edge must keep common conformance, explicit capability degradation, migration, rollback, and local-without-Hub acceptance. |

### Foundation outcomes that remain open

| User outcome | Current observation | State | Completion proof still required |
| --- | --- | --- | --- |
| The user can see how many tokens one requested task consumed. | Managed runs can report scope-bound resource observations. Direct terminal reporting measures only the query-projection call and reports whole-task usage as `unsupported: unmanaged_provider_usage_unobserved`. | partial | Bind provider-turn usage to the direct turn when observable; otherwise keep it explicitly unsupported. Never add projection usage to an unobserved task total. |
| Terminal hooks stay within their reviewed latency budgets. | The retained prior cohort reports Codex Prompt p95 17,122.791 ms against 15,000 ms and Stop p95 16,820.386 ms against 5,000 ms. Shared scan, overlapped snapshot, declaration-bound lifecycle evidence, and cheap Stop gating reduced the first new-build operational observation to Prompt 8,997.680 ms and Stop 1,688.288 ms, but one sample is not a percentile. | partial | Reach the unchanged 30-sample minimum and pass a fresh hook-build cohort without deleting historical failures, weakening availability, or changing qualified retrieval quality. |

## Corrected claim boundaries

- The completed natural-language terminal v1 flow verifies retrieval, workstream checkpoints, declarations, and lifecycle inspection. It does not provide automatic semantic outcome drafting or proactive user attention.
- The completed branch-safe lifecycle verifies typed candidate creation and exact review. Its older direct durable-rule materialization statement was superseded by ADR-0327; no installed direct or explicit consumer currently calls the materializer.
- The completed governed-loop roadmap is the manual v1 slice plus a read-only workstream-goal projection. It is not Prime-Agent-style unattended continuation, native provider-session resume, root-process heartbeat, independent goal mutation, or dynamic topology.
- The completed product-host protocol is a CLI compatibility boundary, not a Paperclip or Buzz product interface.
- A successful full repository check proves the encoded contracts. It cannot prove a user outcome absent from those contracts.

## Delivery order

1. Correct conflicting canonical claims and make this matrix the single completion ledger.
2. Add a cheap provider-neutral attention projection and surface it through installed CLI and direct terminal context without another model call or full lifecycle rescan.
3. Extend finalization with an evidence-bound durable-outcome report and responsible-target draft or review path; keep deterministic maintenance separate from semantic user content.
4. Re-measure and repair terminal hook latency and expose the exact boundary of task token usage.
5. Add checkpointed attach/detach/resume, liveness, and a workstream-backed goal projection before any unattended scheduler; keep native provider resume and scheduling as independently evidenced adapter and authority slices.
6. Complete source-to-skill and reviewable instruction/profile candidate journeys.
7. Version the product-host boundary only when each additive route has packed external-consumer proof.
8. Repair release-impact classification and the remaining CLI README normalization, then run knowledge migration, focused acceptance, release completion from the baseline, packed smoke, and one final full CI run.

## References

- [Product positioning and verified improvement](../research/lervo-product-positioning-and-verified-improvement.md)
- [Agent platform and evolution](../research/lervo-agent-platform-evolution.md)
- [Foundation hardening](foundation-hardening.md)
- [Governed loop and assignment graph](governed-loop-assignment-graph.md)
- [Product-host protocol](../specifications/execution/product-host-protocol.md)
- [Repository knowledge lifecycle convergence](../specs/repository-knowledge-lifecycle-convergence.md)
- [Availability-safe unmanaged terminal hooks](../decisions/execution/providers/hooks/0327-availability-safe-unmanaged-terminal-hooks.md)
