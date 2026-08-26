# Isolated agent workspace lifecycle

Status: `complete`
As of: 2026-08-26

## Problem

Assignment path leases reject declared overlap, but concurrent terminals can still share checkout bytes and a repository-wide `Stop` lifecycle. Per-checkout workforce state cannot coordinate sibling Git worktrees. Dedicated integration authority and evidence-bound automatic cleanup do not exist.

## Product outcome

Each write-capable repository agent uses a dedicated managed worktree. Workers checkpoint and seal only their assignment results. An ordinary repository agent with integration capability combines sealed results in a separate integration worktree, runs repository-wide verification, and advances the canonical workstream.

Integrated worker worktrees are removed automatically only when local evidence proves they are clean, quiescent, reachable, and recoverable. Local coordination works without a Hub. Explicit Hub coordination adds cross-Node scope reservations and status without transferring write, merge, approval, or cleanup authority.

## Delivery order

1. [Completed] Introduce the shared repository-instance coordination home and migrate conflict-free single-checkout workforce state.
2. [Completed] Add workspace identities, generations, ownership markers, lifecycle state, events, and the provider-neutral workspace-host port.
3. [Completed] Implement native Git provisioning and inspection, then bind assignments and one writer session to dedicated worktrees.
4. [Completed] Make direct terminal preparation and `Stop` execution-kind-aware. Workers finalize scoped workspace state; integrators retain repository-wide finalization.
5. [Completed] Implement immutable sealing, deterministic integration queueing, exclusive target-generation leases, path-private collision plans, isolated Git candidate preparation, stale-target rejection, exact conflict abort, content-bound repository-wide candidate verification, and non-checked-out target-ref compare-and-swap advancement. Durable success binds the receipt before movement, atomically commits the authoritative attempt and privacy-bounded event, exactly rolls back pre-commit failures, and idempotently resumes post-commit source projections.
6. [Completed] Add path-private cleanup planning, non-force removal, a private recovery journal, exact reachability, and positive process quiescence. Git may substitute durable Lervo writer closure only when native process observation is unavailable.
7. [Completed] Add an optional Orca CLI host adapter for worktree, live-terminal, linked-review, child-worktree, and visible lifecycle evidence without importing Orca into lifecycle domain packages.
8. [Completed] Add optional Hub reservations, separate permissions, append-only audit transitions, authenticated Node summary reconciliation, and independent health.
9. [Completed] Fix and test v1 capacity at 32 active reservations per project coordinate, 128 retained terminal summaries, 30-day terminal-summary retention, and privacy-bounded local lifecycle-event reconciliation.
10. [Completed] Expose automatic cleanup only behind an explicit repository-policy input after the common Git and Orca gates; disabled policy and any incomplete proof preserve the worktree.

## Completion evidence

- Cleanup plan/apply/recovery tests cover exact path privacy, idempotency, non-force removal, live-terminal blocking, lost host responses, post-removal event interruption, and policy-disabled behavior.
- The Git and Orca adapters implement the same cleanup port. Orca is loaded only by adapter and CLI composition; local lifecycle and Git execution do not depend on Orca installation.
- Hub SQLite and HTTP tests cover overlap, generation fencing, expiry, idempotency, capacity, retention, permissions, unknown-parent rejection, and path-private audit bytes.
- The Node runtime reports workspace coordination separately from event sync, workstream replication, and remote control. Missing configuration reports `disabled`; transport or validation failure reports `unavailable` without affecting `local_first` execution.

## Acceptance

- Two disjoint assignments run concurrently in separate worktrees and share one local scheduler; overlapping claims fail before either writer starts.
- A second writer or foreign path mutation produces a bounded isolation error. `Stop` does not require the affected worker to update another workspace's global workstream.
- A sealed result binds clean commits, changed-path digest, verification, and durable artifacts, and remains integrable after its agent exits.
- Exactly one integration assignment owns each target generation. Stale targets and conflicts preserve worker results and advance neither the target nor the current workstream.
- Repository-wide documentation, knowledge, lint, and verification run only against the integrated checkout before the integrator advances the workstream.
- An integrated, clean, quiescent, Lervo-owned worktree is removed without force. Dirty, untracked, live, linked, unintegrated, unreachable, uncertain, symbolic, or recovery-marked worktrees remain.
- Interrupted cleanup deterministically restores eligibility or completes metadata cleanup from durable evidence; it never recursively deletes an uncertain directory.
- Worktree deletion does not implicitly delete its sealed result, integration evidence, assignment history, branch, or remote ref.
- The Git adapter passes the common host contract. The Orca adapter also proves live-terminal protection and updates Orca-visible lifecycle status.
- `local_first` passes without Hub. `hub_coordinated` rejects cross-Node overlap, fences stale generations, survives lost acknowledgements, and never grants remote cleanup or approval authority.
- Hub workstream divergence remains separate and cannot be resolved by reservations or integration queue order.
- Event and Hub payload tests prove exclusion of paths, branch names, source and patch bodies, prompts, provider output, credentials, approvals, and reasoning.
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
