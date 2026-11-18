# Governed loop and assignment graph

Status: `complete`

As of: 2026-09-07

Completion covers the bounded manual slices below. Root-agent and managed-provider liveness, the read-only repository-goal lifecycle, bounded unattended scheduling, and reviewed additive dynamic topology are installed. Native provider session resume and independent nested-goal mutation remain external or separate scope in the [product outcome convergence roadmap](product-outcome-convergence.md).

## Goal

Add bounded continuation and graph execution without a second task database or weaker managed execution. One provider-neutral headless application contract replays current workstreams, assignments, managed-run causality, verification, resource observations, and leases.

```text
manual or bounded scheduler trigger -> verified checkpoint -> assignment decision
                                    -> managed attempt -> observe -> verify
                                    -> complete | retry | block | escalate
```

## Completed slices

- [Execution and authority](governed-loop-assignment-graph/execution.md): GLA1–3 and GLA17; graph decisions, approval, cancellation, prepared completion, and resource budgets.
- [Operating reports and product host](governed-loop-assignment-graph/operating.md): GLA4–5 and GLA14–16; local board, objective, observed budgets, capabilities, attention, and goal projection.
- [Collaboration and connectors](governed-loop-assignment-graph/collaboration.md): GLA6–8, GLA11, and GLA18; interactions, routines, authenticated delivery, Slack, reviewed message triggering, and explicit acknowledgment.
- [Improvement observation](governed-loop-assignment-graph/improvement.md): GLA9–10 and GLA12–13; reviewed effects, bounded local metrics, and explicit CLI authority.

## Responsibility boundaries

| Boundary | Owns | Does not own |
| --- | --- | --- |
| `@lervo/application-contract` | Versioned graph, policy, decision, query, and command shapes | Storage, provider calls, CLI formatting |
| `@lervo/work-controller` | Pure assignment/event projections and next-action decisions | Event append, leases, writes, scheduling |
| `@lervo/agent-workforce` | Assignment state, dependencies, leases, handoff, completion | Provider execution or loop policy |
| `@lervo/orchestrator` | One managed attempt and its causal, resource, and stage evidence | Multi-attempt policy or product presentation |
| `@lervo/operating-client` | Pure board projection and static local presentation | Storage, policy, commands, mutation |
| CLI and future product adapters | Trusted port composition and product presentation | Alternate graph, task, budget, or truth stores |

Events, CAS artifacts, assignment state, verification, and repository state remain canonical. Graphs, loop decisions, and operating views are rebuildable projections.

## Non-goals

- An unbounded daemon, operating-system scheduler installation, or in-flight provider preemption.
- Arbitrary graph cycles or agent-authored topology mutation.
- Third-party code execution inside the controller.
- Estimated money presented as billed cost.
- Automatic approval, cancellation mutation, or uncertain-effect retry.
- A mutable Paperclip-like task database or Buzz-like collaboration database.
- Changing direct provider terminals from `unmanaged` to managed.

## Recorded future candidate

Event-driven scheduler wake-up is a candidate for later evaluation, not accepted delivery. A trusted assignment or topology event could wake one bounded scheduler invocation before its next poll. The signal would be advisory: canonical assignment state, exact-revision claim, the existing scheduler lock, kill switch, execution budgets, and polling reconciliation would retain authority.

Before implementation, a separate reviewed contract must define signal authentication, replay and deduplication, coalescing and backpressure, lost-signal recovery, service lifecycle, privacy, and failure meaning. Polling remains the recovery path; a wake-up must never itself claim or execute an assignment.

## Conditional future sequence

1. Add a second connector only for a current product need. Reuse shared conformance; keep provider-native credentials, destinations, receipts, and recovery semantics in its adapter.
2. Add another improvement metric only after its counting unit, evidence source, ground truth, privacy boundary, and versioned policy are explicit.

## References

- [Foundation enhancement handoff](foundation-hardening/verification-and-handoff.md)
- [Agent platform evolution research](../research/lervo-agent-platform-evolution.md)
- [ADR-0336](../decisions/execution/orchestration/governed-work/0336-adopt-headless-governed-loop-and-assignment-graph.md)
- [ADR-0337](../decisions/execution/orchestration/governed-work/0337-bind-assignment-approval-and-cancellation-authority.md)
- [ADR-0338](../decisions/execution/orchestration/governed-work/0338-reconcile-prepared-managed-assignment-completion.md)
- [ADR-0340](../decisions/execution/orchestration/governed-work/0340-add-read-only-local-operating-board.md)
- [ADR-0341](../decisions/execution/orchestration/governed-work/0341-project-current-objective-and-observed-token-budgets.md)
- [ADR-0342](../decisions/execution/orchestration/governed-work/0342-project-assignment-interactions-from-workforce-handoffs.md)
- [ADR-0344](../decisions/execution/orchestration/governed-work/0344-deliver-assignment-artifacts-through-injected-connectors.md)
- [ADR-0345](../decisions/execution/orchestration/improvement/0345-observe-reviewed-improvement-effects-without-self-learning-claims.md)
- [ADR-0346](../decisions/execution/orchestration/improvement/0346-measure-improvement-effects-from-bounded-local-events.md)
- [ADR-0347](../decisions/execution/orchestration/governed-work/0347-deliver-assignments-through-a-production-slack-connector.md)
- [ADR-0348](../decisions/execution/orchestration/improvement/0348-measure-exact-repeated-verification-failures.md)
- [ADR-0349](../decisions/execution/orchestration/improvement/0349-expose-local-improvement-observations-through-an-explicit-cli-host.md)
- [ADR-0354](../decisions/operations/trace/0354-enforce-scope-complete-resource-and-terminal-budgets.md)
- [ADR-0355](../decisions/execution/applications/0355-expose-versioned-packed-product-host-protocol.md)
- [ADR-0361](../decisions/execution/applications/0361-project-operating-attention-without-new-authority.md)
- [ADR-0365](../decisions/execution/orchestration/governed-work/0365-project-workstream-goals-over-the-assignment-dag.md)
- [ADR-0373](../decisions/execution/orchestration/governed-work/0373-enforce-managed-execution-dimension-and-duration-budgets.md)
- [ADR-0375](../decisions/execution/orchestration/governed-work/0375-route-reviewed-direct-messages-and-record-explicit-handoff-acknowledgment.md)
- [ADR-0379](../decisions/execution/orchestration/governed-work/0379-install-bounded-unattended-assignment-scheduling.md)
- [Assignment interaction specification](../specifications/execution/assignment-interactions.md)
- [Assignment connector specification](../specifications/execution/assignment-connectors.md)
- [Assignment routine specification](../specifications/execution/assignment-routines.md)
- [Bounded unattended scheduler specification](../specifications/execution/unattended-scheduling.md)
- [Bounded dynamic assignment topology](../specifications/execution/dynamic-assignment-topology.md)
- [Reviewed direct-message trigger specification](../specifications/execution/assignment-message-triggers.md)
- [Verified improvement-effect dogfood](../evidence/pilots/verified-improvement-effect-dogfood.md)
- [Execution specification](../specifications/execution.md)
