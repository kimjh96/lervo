# ADR-0365: Project workstream goals over the assignment DAG

Status: `accepted`  
Date: 2026-09-04

## Context

Lervo exposed the current objective and governed assignment graph separately, requiring callers to infer their relationship as a goal lifecycle. An independent goal store would duplicate workstream and assignment authority. Prime-Agent-style terminology must not give a projection new execution or scheduling power.

## Decision

Treat the verified current workstream as the repository's single root goal and its workstream-bound assignments as the execution DAG. Add a storage-free `OperatingGoalReportV1` and pure projection that:

- Checks source coordinates.
- Retains the exact graph.
- Counts assignment states.
- Distinguishes active, blocked, ready-for-completion, completed, and inconsistent observations.

Expose the report through the read-only `lervo loop goal` command. Add `operating_goal.inspect` to explicit product-host protocol version 2 while keeping version 1 as the default. The CLI inspector reads existing workstream, workforce, and event authorities and starts no provider.

Explicit workstream completion remains authoritative; the projection never auto-completes a goal. A completed workstream with unresolved assignments or pending blocking authority is inconsistent.

V1 has no independent nested-goal mutation, dynamic graph mutation, or unattended scheduler.

## Consequences

Repository agents and external products receive one portable Lervo-style goal view without another truth store. Goal prose, assignment execution, presentation, and future trigger adapters remain separate responsibilities.

Supporting multiple independent root goals or unattended continuation requires a new version with its own authority, recovery, budget, and cancellation evidence.

## Verification

- Pure tests cover active composition, false authority flags, inconsistent completion, and coordinate mismatch.
- CLI tests prove read-only rendering without managed execution.
- The packed external consumer discovers the additive route and inspects the workstream-assignment hierarchy using only the installed CLI.

## References

- [Operating goals](../../../../specifications/execution/operating-goals.md)
- [Headless governed loop](0336-adopt-headless-governed-loop-and-assignment-graph.md)
- [Current objective](0341-project-current-objective-and-observed-token-budgets.md)
