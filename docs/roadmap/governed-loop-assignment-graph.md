# Governed loop and assignment graph

Status: `active`

As of: 2026-09-02

## Goal

Add bounded continuation and graph execution without creating a second task database,
weakening managed execution, or granting unattended authority. The first usable slice
replays current workstreams, assignments, managed-run causality, verification, resource
observations, and leases through one provider-neutral headless application contract.

```text
manual trigger -> verified checkpoint -> assignment decision -> managed attempt
               -> observe -> verify -> complete | retry | block | escalate
```

## Responsibility boundaries

| Boundary                        | Owns                                                            | Does not own                                   |
| ------------------------------- | --------------------------------------------------------------- | ---------------------------------------------- |
| `@lervo/application-contract`   | versioned graph, policy, decision, query, and command shapes    | storage, provider calls, CLI formatting        |
| `@lervo/work-controller`        | pure assignment/event projections and next-action decisions     | event append, leases, writes, scheduling       |
| `@lervo/agent-workforce`        | assignment state, dependencies, leases, handoff, and completion | provider execution or loop policy              |
| `@lervo/orchestrator`           | one managed attempt and its causal/resource/stage evidence      | multi-attempt policy or product presentation   |
| `@lervo/operating-client`       | pure board projection and static local presentation             | storage, policy, commands, or mutation         |
| CLI and future product adapters | trusted port composition and product presentation               | alternate graph, task, budget, or truth stores |

Events, CAS artifacts, assignment state, verification, and repository state remain
canonical. Graphs, loop decisions, and operating views are rebuildable projections.

## GLA1: First vertical slice

The first slice provides:

- one graph projection over current-workstream assignments, including roots, parallel
  ready nodes, joins, exact approval-requirement digests, leases, and attempt counts;
- cycle, self-dependency, duplicate, and cross-workstream dependency findings;
- one governed decision for claim, start, retry, approval wait, dependency wait,
  cancellation propagation, block, escalation, or completion;
- at most 16 attempts per assignment and 32 parallel assignments, with active attempts
  consuming capacity before another claim, start, or retry is recommended;
- exact provider and accounting-descriptor token admission thresholds without
  cross-provider or cross-descriptor addition or an advance-reservation claim;
- complete, partial, unavailable, and invalid resource handling, never inferred zero;
- assignment- and agent-bound causal root and retry records;
- fail-closed attempt-to-assignment and provider-resource attribution checks;
- manual `lervo loop status` and `lervo loop run` application routes over the same public
  contract; and
- provider-run success finalization only after verification and writing publication pass.

The controller retains no mutable loop state. Restart and resume replay existing
canonical state. A completed managed run whose assignment finalization outcome is not
observable becomes `completion_reconciliation_required`; it is not rerun automatically.

## Approval and cancellation limits

GLA2 adds the provider-neutral approval-authority port and requires exact assignment,
requirement-digest, evidence-hash, and validity-interval bindings. The default CLI still
provides no authority adapter, so an approval-gated assignment remains `await_approval`;
command-line text is not authority.

GLA2 also adds a content-addressed, revision-bound single-assignment cancellation plan and
the distinct `assignment.cancelled` transition. Only queued or blocked work is cancellable.
Leased work remains protected even after expiry because expiry does not prove provider
termination. Dependency propagation remains explicit and incremental rather than a hidden
multi-assignment transaction.

## GLA2: Authority and cancellation transition

The second slice provides:

- a storage- and provider-neutral approval authority query/observation port;
- fail-closed rejection of duplicate, foreign, malformed, or expired approval evidence;
- exact assignment-requirement matching rather than digest-only approval sharing;
- deterministic cancellation planning bound to current assignment revision and status;
- exact plan/apply CLI composition for requested and dependency-driven cancellation; and
- state/event rollback with the privacy-bounded `assignment.cancelled` event.

It does not add an approval issuer, infer model self-approval, cancel leased provider work,
or make the controller effectful.

## GLA3: Prepared completion reconciliation

The third slice records privacy-bounded completion preparation after managed verification and
writing-publication acceptance but before ordinary assignment finalization. A matching prepared
completion can be reconciled through an exact report-bound plan/apply transition without rerunning
provider work. Missing or stale preparation evidence remains escalation-required, and lease expiry
alone never turns a completed attempt back into claimable work.

GLA3 is accepted when focused tests prove canonical run and result binding, rejection of foreign
or malformed preparation, no reclaim after verified completion, explicit no-write planning,
exact stale-plan recheck, expired-original-lease recovery, and state rollback when reconciliation
event persistence fails. Quality, type, build, full tests, documentation and knowledge lifecycle,
foundation checks, and task-base release completion must pass with reviewed minor release intent.

## GLA4: Minimal local operating client

The fourth slice adds a read-only graphical reference client over the exact governed-work report.
`@lervo/operating-client` has no storage, Hub, provider, or mutation dependency. It projects report
evidence into a board view model and renders deterministic self-contained HTML. The CLI supplies
that report through `lervo loop board`; the generated document contains no script, form, server,
network dependency, or state-changing control.

GLA4 is accepted when focused tests prove assignment and dependency projection, attempt, approval,
completion, action, and resource visibility, deterministic escaped HTML, explicit evidence
limitations, no mutation-port invocation, and invalid-report exit preservation. Quality, type,
package-boundary, build, full tests, documentation and knowledge lifecycle, foundation checks, and
task-base release completion must pass with reviewed minor release intent.

## GLA5: Current objective and observed token budgets

The fifth slice exposes the verified current workstream objective through a storage-free application
report and relates exact configured token admission limits to exact provider and accounting-group
resource observations. `lervo loop objective` reads no managed-work state; `lervo loop budget`
performs no mutation and reports partial, unavailable, invalid, or absent evidence as unknown. The
local board composes both independent reports and continues to escape prose and provide no controls.

GLA5 is accepted when focused tests prove verified objective translation, no managed-work query for
objective inspection, exact accounting-group matching, no unknown-to-zero conversion, observed
remaining-token projection, board prose escaping, and no mutation-port invocation. Quality, type,
package-boundary, build, full tests, documentation and knowledge lifecycle, foundation checks, and
task-base release completion must pass with reviewed minor release intent.

## GLA6: Assignment interactions, mentions, and inboxes

GLA6 reuses `assignment.handoff.recorded` as the canonical route instead of adding a collaboration
database or a second task authority. A provider-neutral mention plan resolves exact agent, unique
active role, recorded manager, reviewer-role, or verifier-role targets. It binds the current
workstream, assignment revision, source agent, lease, request digest, artifact coordinates, and
context evidence. Exact apply delegates to the existing workforce handoff transition.

The storage-free application contract and pure work-controller projection rebuild deterministic
assignment threads and recipient inbox items from current-workstream handoffs. They exclude bodies
and report route recording separately from unobserved delivery and acknowledgment. Read-only CLI
routes and the local operating board consume the same report. External connectors, team expansion,
provider switching, implicit assignment creation, and deliberation startup remain out of scope.

GLA6 is accepted when focused tests prove exact agent, unique role, and manager resolution;
ambiguous, inactive, self, disallowed-role, workstream, and lease failures; exact plan/apply;
content-free thread and inbox projection; missing identity invalidation; read-only CLI inspection;
and no delivery or acknowledgment inference. Quality, type, package-boundary, build, full tests,
documentation and knowledge lifecycle, foundation checks, and task-base release completion must
pass with reviewed minor release intent.

## GLA7: Exact assignment routines and manual triggers

GLA7 adds content-bound assignment templates and one explicit local manual trigger. The pure
controller validates at most 32 acyclic nodes, exact role and optional capability bindings, and
`skip_if_active`, `coalesce_if_active`, or bounded-enqueue admission. It derives deterministic
invocation and assignment IDs and exposes an exact plan without template, acceptance, approval, or
path prose.

Apply rechecks under a transient routine lock and delegates each node to existing workforce
assignment creation. Routine provenance is additive assignment state and `assignment.created`
metadata, not a second task or scheduler store. Multi-node apply is convergent: committed nodes
remain canonical, deterministic replay is idempotent, and a fresh plan resumes only missing nodes.
Materialization creates no lease and starts no provider.

GLA7 is accepted when focused tests prove deterministic DAG expansion, role and capability drift
rejection, stale-plan blocking, idempotent creation, partial resume, capability-bound claim,
skip/coalesce/enqueue distinctions, concurrency and capacity bounds, privacy allowlisting, and no
arbitrary prompt execution or unattended trigger. Quality, type, package-boundary, build, full
tests, documentation and knowledge lifecycle, foundation checks, and task-base release completion
must pass with reviewed minor release intent.

## Non-goals

- unattended or timer-based scheduling;
- arbitrary graph cycles or agent-authored topology mutation;
- third-party code execution inside the controller;
- estimated money presented as billed cost;
- automatic approval, cancellation mutation, or uncertain-effect retry;
- a mutable Paperclip-like task database or Buzz-like collaboration database; and
- changing direct provider terminals from `unmanaged` to managed.

## Acceptance

GLA1 is accepted only when focused tests prove parallel roots and a join, exact retry
ancestry, approval blocking, cancellation propagation, resource exhaustion and missing
telemetry behavior, managed-run causal binding, CLI port composition, and no new
canonical store. Quality, type, package-boundary, build, relevant full tests,
documentation lifecycle, and task-base release-completion checks must pass with reviewed
minor release intent.

## Next sequence

1. Add Buzz-like connector routes without granting room-based authority.
2. Connect verified improvement candidates and post-promotion effect observation.

## References

- [Foundation enhancement handoff](foundation-hardening/verification-and-handoff.md)
- [Agent platform evolution research](../research/lervo-agent-platform-evolution.md)
- [ADR-0336](../decisions/execution/orchestration/0336-adopt-headless-governed-loop-and-assignment-graph.md)
- [ADR-0337](../decisions/execution/orchestration/0337-bind-assignment-approval-and-cancellation-authority.md)
- [ADR-0338](../decisions/execution/orchestration/0338-reconcile-prepared-managed-assignment-completion.md)
- [ADR-0340](../decisions/execution/orchestration/0340-add-read-only-local-operating-board.md)
- [ADR-0341](../decisions/execution/orchestration/0341-project-current-objective-and-observed-token-budgets.md)
- [ADR-0342](../decisions/execution/orchestration/0342-project-assignment-interactions-from-workforce-handoffs.md)
- [Assignment interaction specification](../specifications/execution/assignment-interactions.md)
- [Assignment routine specification](../specifications/execution/assignment-routines.md)
- [Execution specification](../specifications/execution.md)
