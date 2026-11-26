# ADR-0640: Coordinate agents in the workstream, and let Git store and publish

Status: `accepted`
Decision date: 2026-11-26
Part of: [ADR-0637](../applications/0637-build-projects-agents-and-conversations-in-the-ade-on-the-core.md)
Related: [ADR-0205](0205-conflict-safe-repository-agent-workforce.md), [ADR-0222](0222-isolated-agent-workspace-lifecycle.md), [ADR-0633](../providers/hooks/0633-record-a-linked-worktree-in-its-registered-repository.md)

## Context

On 2026-11-26 the owner observed that Git suits people working together over days, while agents work in minutes, in parallel, on the same files, so branches and pull requests become a bottleneck and conflicts surface late. The owner asked for a workstream-based protocol, laid as a foundation before implementation.

The core already has most of the parts. Path leases block their ancestors, and `.` and `*` overlap every path (ADR-0205). A write-capable assignment gets its own worktree generation with exactly one writer session, and one integration agent moves the target ref under an exclusive lease with compare-and-swap (ADR-0222). The packages implement this, but no command runs integration, and ADE workspaces use none of it (ADR-0633).

## Decision

- Git stays the storage and the publication boundary. Content addressing, history, diff and merge, and the hosting and CI people use all remain Git's.
- Coordination between agents moves to the workstream:
  - An agent claims each path before it changes it, so a conflict surfaces at claim time instead of at merge time.
  - Handoffs carry their evidence.
  - An integration agent integrates small sealed changes often (ADR-0222).
  - A pull request carries a batch of integrated work to people.
- A coordination specification is written before implementation. It defines the units (project, workstream, assignment, lease, workspace generation, integration attempt, publication), their events, and how the ADE drives integration. It reuses ADR-0205 and ADR-0222 and adds only what they lack: growing leases and a command that runs integration.

## Consequences

- Conflicts between agents surface when they claim paths, not when their branches meet.
- People keep reviewing work as pull requests, in larger and fewer batches.
- The coordination specification is written before any of this is implemented.
