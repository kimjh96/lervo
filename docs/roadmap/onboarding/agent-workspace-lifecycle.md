# Isolated agent workspace lifecycle

Status: `in_progress`
As of: 2026-08-26

## Problem

Assignment path leases reject declared overlap, but concurrent terminals can still share checkout bytes and one repository-wide Stop lifecycle. Per-checkout workforce state also cannot coordinate sibling Git worktrees. There is no dedicated integration authority or evidence-bound automatic worktree cleanup.

## Product outcome

Each write-capable repository agent works in a dedicated managed worktree. Workers checkpoint and seal only their assignment result. An ordinary repository agent with integration capability combines sealed results in a separate integration worktree, runs repository-wide verification, and advances the canonical workstream. Integrated worker worktrees are removed automatically only when local evidence proves they are clean, quiescent, reachable, and recoverable.

Local coordination works without a Hub. Projects that explicitly enable Hub coordination gain cross-Node scope reservations and status without transferring write, merge, approval, or cleanup authority.

## Delivery order

1. [Completed] Introduce the shared repository-instance coordination home and migrate conflict-free single-checkout workforce state.
2. [Completed] Add workspace identities, generations, ownership markers, lifecycle state, events, and the provider-neutral workspace-host port.
3. [In progress] Implement native Git provisioning and inspection, then bind assignments and one writer session to dedicated worktrees. Provision plan/apply is implemented; writer-session activation remains with terminal integration.
4. Make direct terminal preparation and Stop execution-kind-aware; workers finalize scoped workspace state while integrators retain repository-wide finalization.
5. Add immutable sealing, deterministic integration queueing, exclusive target leases, exact Git integration plans, and conflict recovery.
6. Add path-private cleanup planning, non-force removal, crash recovery, and positive process quiescence. Keep automatic cleanup disabled until these gates pass.
7. Add an Orca host adapter for managed worktree and terminal evidence without importing Orca into lifecycle domain packages.
8. Add optional Hub reservations, permissions, audit transitions, Node reconciliation, health, and cross-Node acceptance.
9. Set and verify bounded Hub capacity, terminal-summary retention, and local coordination-event synchronization before coordinated rollout.
10. Enable automatic cleanup by repository policy only after Git and Orca adapter acceptance passes.

## Acceptance

- Two disjoint assignments run concurrently in separate worktrees and share one local scheduler; overlapping claims fail before either writer starts.
- A second writer or foreign path mutation in one checkout produces a bounded isolation error. Stop does not require the affected worker to update another workspace's global workstream.
- A sealed result binds clean commits, changed-path digest, verification, and durable artifacts and remains integrable after its agent process exits.
- Exactly one integration assignment owns each target generation. Stale targets and conflicts leave worker results intact and advance neither target nor current workstream.
- Repository-wide documentation, knowledge, lint, and verification run only against the integrated checkout before the integrator advances the workstream.
- An integrated, clean, quiescent Lervo-owned worktree is removed without force. Dirty, untracked, live, linked, unintegrated, unreachable, uncertain, symbolic, or recovery-marked worktrees remain.
- Interrupted cleanup deterministically restores eligibility or completes metadata cleanup from durable evidence; it never recursively deletes an uncertain directory.
- Deleting a worktree does not delete its sealed result, integration evidence, assignment history, branch, or remote ref as an implicit side effect.
- The Git adapter passes the common host contract. The Orca adapter additionally proves live-terminal protection and updates Orca-visible lifecycle status.
- `local_first` passes with Hub absent. `hub_coordinated` rejects cross-Node overlap, fences stale generations, survives lost acknowledgements, and never grants remote cleanup or approval authority.
- Hub workstream divergence remains separate and cannot be resolved by reservations or integration queue order.
- Event and Hub payload tests prove that paths, branch names, source and patch bodies, prompts, provider output, credentials, approvals, and reasoning are excluded.
- Hub active-reservation capacity and terminal-summary retention are versioned, audited, and tested; capacity rejection never evicts a live reservation.

## Non-goals

- Fuzzy semantic merge or automatic conflict editing.
- Automatic branch or remote-ref deletion.
- Treating process exit, lease expiry, or Hub timeout as proof of completion.
- Making Orca or Hub mandatory for local execution.
- Sharing provider sessions, conversation memory, or uncommitted checkout bytes between agents.

## Dependencies

- [Isolated agent workspace ADR](../../decisions/execution/orchestration/0222-isolated-agent-workspace-lifecycle.md)
- [Agent workspace specification](../../specifications/execution/agent-workspaces.md)
- [Repository agent workforce](agent-workforce.md)
- [Hub and Node coordination](../../specifications/coordination/hub-and-node.md)
