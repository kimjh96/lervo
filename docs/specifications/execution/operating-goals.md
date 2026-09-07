# Operating goals

Status: `active`

As of: 2026-09-04

## Purpose

Lervo represents one repository-level operating goal without a second goal or task database. The verified current workstream is root-goal authority. Its bound assignments form the execution hierarchy; the assignment DAG remains authoritative.

`lervo loop goal` composes these sources into `OperatingGoalReportV1`. Explicit protocol version 2 also advertises `operating_goal.inspect` for separately installed Paperclip, Buzz, and other product hosts. Both routes work locally without a Hub.

## Projection

The report contains:

- the exact workstream ID, revision, explicit status, title, objective, and update time;
- the complete bounded assignment graph for that workstream;
- counts of queued, active, blocked, failed, completed, and cancelled assignments;
- a derived completion status; and
- explicit false authority flags for goal creation, workstream or assignment mutation, and provider startup.

`ready_for_completion` means all observed assignments are terminal, no blocking authority remains, and the workstream has no next action. It does not complete the workstream. `completed` requires the canonical workstream to report completion. A completed workstream with unresolved assignments or blocking authority is `inconsistent`, not inferred success.

## Boundaries

The graph is a rebuildable projection. Workstream snapshots, assignments, leases, events, verification, and repository state remain canonical. V1 does not create independent nested goals, rewrite assignment dependencies, schedule work, grant approval, or infer completion from silence.

The separate product-host protocol v5 scheduler consumes the projection under its own bounded execution authority; this read-only goal contract grants none.

## References

- [Governed loop and assignment graph](../../roadmap/governed-loop-assignment-graph.md)
- [Product-host protocol](product-host-protocol.md)
- [ADR-0365](../../decisions/execution/orchestration/governed-work/0365-project-workstream-goals-over-the-assignment-dag.md)
