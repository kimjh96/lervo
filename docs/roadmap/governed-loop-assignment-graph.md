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
| CLI and future product adapters | trusted port composition and presentation                       | alternate graph, task, budget, or truth stores |

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

## Non-goals

- unattended or timer-based scheduling;
- arbitrary graph cycles or agent-authored topology mutation;
- third-party code execution inside the controller;
- estimated money presented as billed cost;
- automatic approval, cancellation mutation, or uncertain-effect retry;
- a Paperclip-like board or Buzz-like collaboration database; and
- changing direct provider terminals from `unmanaged` to managed.

## Acceptance

GLA1 is accepted only when focused tests prove parallel roots and a join, exact retry
ancestry, approval blocking, cancellation propagation, resource exhaustion and missing
telemetry behavior, managed-run causal binding, CLI port composition, and no new
canonical store. Quality, type, package-boundary, build, relevant full tests,
documentation lifecycle, and task-base release-completion checks must pass with reviewed
minor release intent.

## Next sequence

1. Build a minimal local operating client over the headless query and command types.
2. Add Paperclip-like goal, routine, board, and budget routes as replaceable adapters.
3. Add Buzz-like inbox, mention, thread, and connector routes without granting room-based authority.
4. Connect verified improvement candidates and post-promotion effect observation.

## References

- [Foundation enhancement handoff](foundation-hardening/verification-and-handoff.md)
- [Agent platform evolution research](../research/lervo-agent-platform-evolution.md)
- [ADR-0336](../decisions/execution/orchestration/0336-adopt-headless-governed-loop-and-assignment-graph.md)
- [ADR-0337](../decisions/execution/orchestration/0337-bind-assignment-approval-and-cancellation-authority.md)
- [ADR-0338](../decisions/execution/orchestration/0338-reconcile-prepared-managed-assignment-completion.md)
- [Execution specification](../specifications/execution.md)
