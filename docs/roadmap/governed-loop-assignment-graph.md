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

Approval requirements are projected as digests. The pure controller accepts only
verified approval observations from an authority adapter. The initial CLI provides no
such adapter, so an approval-gated assignment remains `await_approval` rather than
accepting a command-line assertion as authority.

Cancellation propagation is a pure bounded decision over current assignment status.
The first slice does not add a new cancellation event or mutation by reinterpreting the
existing `assignment.completed` event. A later cancellation writer requires its own
versioned event, privacy, compatibility, recovery, and activation decision.

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

1. Add an authority-backed approval and cancellation transition contract.
2. Add crash-reconciliation evidence for the narrow completed-run/finalization gap.
3. Build a minimal local operating client over the headless query and command types.
4. Add Paperclip-like goal, routine, board, and budget routes as replaceable adapters.
5. Add Buzz-like inbox, mention, thread, and connector routes without granting room-based authority.
6. Connect verified improvement candidates and post-promotion effect observation.

## References

- [Foundation enhancement handoff](foundation-hardening/verification-and-handoff.md)
- [Agent platform evolution research](../research/lervo-agent-platform-evolution.md)
- [ADR-0336](../decisions/execution/orchestration/0336-adopt-headless-governed-loop-and-assignment-graph.md)
- [Execution specification](../specifications/execution.md)
