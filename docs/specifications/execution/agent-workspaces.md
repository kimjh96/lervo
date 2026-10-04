# Agent workspace, integration, and cleanup specification

Status: `active`
As of: 2026-09-28

This execution-space contract refines, without replacing, assignment path leases. Planned behavior and implemented capabilities are distinguished in the topic specifications.

## Invariants

1. Every write-capable workspace generation has one assignment lease and one writer session.
2. Worker worktrees, integration worktrees, and unmanaged checkouts are distinct execution kinds.
3. Sibling worktrees in one Git repository instance share local coordination without requiring a Hub.
4. Workers own only their assignment-scoped diff and workspace checkpoint. The integrator owns repository-wide convergence and the current workstream.
5. Removal requires exact local evidence of integration or explicit discard and no live owner, subject to the never-used supervised-checkout retirement contract.
6. Host products such as Orca remain behind an adapter. Git, provider, and Hub details stay outside the lifecycle domain contract.

## Specifications

- [Workspace identity, provisioning, writers, and sealing](agent-workspaces/workspace-lifecycle.md)
- [Integration, verification, and durable success](agent-workspaces/integration.md)
- [Cleanup and never-used checkout retirement](agent-workspaces/cleanup.md)
- [Hub coordination, events, boundaries, and verification](agent-workspaces/coordination-and-verification.md)

## Operating flow

1. Natural-language dispatch resolves a durable agent and assignment with expected paths, dependencies, verification, and `local_first` or `hub_coordinated` policy.
2. The scheduler rejects overlapping local leases and obtains a Hub reservation for coordinated work.
3. Provisioning creates an isolated worktree from an exact base. The host starts or binds one writer only after `ready` is committed.
4. The worker changes only expected paths. Terminal finalization updates assignment and workspace state, not the repository-wide current workstream.
5. Completion freezes writes, verifies and seals committed bytes, and queues the immutable result after dependencies complete.
6. An integration assignment selects exact sealed generations in a separate worktree, incorporates them, runs focused and repository-wide verification, refreshes canonical knowledge, and advances the current workstream.
7. Integrated source workspaces become cleanup candidates. An exact local plan removes only clean, quiescent, Lervo-owned worktrees while preserving branches and durable evidence.

Agents perform lifecycle bookkeeping from natural-language requests; users need not relay commands between agents. Provisioning normally occurs during assignment claim. Direct provisioning uses the same assignment and exact-plan contract and cannot create an unassigned writer.

Command roadmap:

- `lervo workspace inspect|cleanup|recover` is implemented; `current|list|show|status` is planned.
- `lervo workspace seal`, with read-only plan and exact apply.
- `lervo integration queue|plan|apply|resolve`.

## References

- [Background recovery contract](../../specs/background-knowledge-convergence/recovery-and-retention.md): bounded automatic integrator-workspace closure.
- [Execution events and privacy](events-and-privacy.md): canonical local events and Hub audit transitions.
- [Isolated workspace lifecycle ADR](../../decisions/execution/orchestration/0222-isolated-agent-workspace-lifecycle.md)
- [Conflict-safe workforce ADR](../../decisions/execution/orchestration/0205-conflict-safe-repository-agent-workforce.md)
- [Hub and Node coordination](../coordination/hub-and-node.md)
- [Local data and state lifecycle](state-lifecycle.md)
