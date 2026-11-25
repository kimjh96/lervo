# ADR-0633: Record a linked worktree in its registered repository

Status: `accepted`
Decision date: 2026-11-25
Amends: [ADR-0451](../../../knowledge/repository/canonicalization/0451-keep-terminal-hooks-off-the-developer-critical-path.md), [ADR-0632](../../applications/0632-build-the-ade-as-the-platform-where-the-core-works.md)
Related: [ADR-0222](../../orchestration/0222-isolated-agent-workspace-lifecycle.md)

## Context

An ADE workspace is a linked git worktree of a registered repository, and so are a developer's extra checkouts. Lervo's terminal hooks and CLI commands resolved the repository from the working directory, so a session there used the worktree's own `.lervo/data`. On 2026-11-25 an audit of an ADE session found:

- The worktree has no event-writer contract (`.lervo/data/` is ignored), so its writer is schema 1. Stage observations, repository changes, and skill events were refused.
- Owner-instruction captures, skill and practice queues, resident requests, the workstream, and plan items stayed in the worktree. No resident drains a worktree, nothing syncs it to the Hub, and `lervo workspace retire` deletes it.
- Context delivery worked. Turn evidence (`terminal.context.prepared`, `context.selected`, `terminal.reference.observed`, `terminal.turn.observed`) was recorded nowhere the repository could see.

The owner's rule is that every core guarantee a terminal session has must hold in the ADE. Managed runs already split their roots: they open storage at the canonical repository, execute in the checkout, and read context from the canonical root. The agent-workforce workspace model was not used: a worker binding turns owner capture off, pauses the workspace at every Stop, requires an assignment, and still writes to the checkout's own store.

## Decision

A session in a linked worktree of a registered repository runs in its own files and records into the repository.

- `resolveTerminalRoots` names two roots.
  - The **execution root** is the checkout's Lervo project.
  - The **evidence root** is the same place in the main checkout, which Git names through the common directory. It applies when that place is a registered repository.
  - A main checkout, an unregistered main checkout, a bare repository's worktree, and a live workforce workspace keep a single root, each with a recorded reason.
- The evidence root holds what belongs to the repository:
  - events, stage observations, and open-turn markers;
  - owner-instruction capture, skill, and practice queues, and resident requests;
  - cursors, activation receipts, and the worker entry;
  - plan items, the workstream's events and branch bindings, and owner rules.
- The execution root holds what belongs to the checkout:
  - the repository snapshot and every per-checkout cache, and the prepared snapshot Stop compares;
  - the bytes and hashes the context describes, and the repository policy;
  - the current-workstream projection and the checked-out branch;
  - the integration and handoff checks.
- Hooks, `lervo workstream`, `lervo plan`, `lervo knowledge query`, `lervo terminal declare`, and owner-rule intake all resolve both roots. A knowledge query ranks against the repository's projection and hashes its selections from the checkout's files.
- The commands an agent runs to check its work resolve both roots too: `lervo terminal status`, `coverage`, and `budget`, `lervo knowledge instruction capture`, and `lervo application attention`. They report the repository's evidence, captures, and attention, with the checkout's files and workstream.
- When no branch bindings exist yet, the first workstream read in a linked worktree binds the worktree's own branch, never the default branch. The worktree's projection was made for its branch, and binding it to the default branch would leave that branch unbound and clear the projection.
- A linked worktree's changed files are recorded on its turn, but it records no repository change. No knowledge job applies branch bytes to the main checkout.
- `lervo workspace start` creates the ADE workspace's workstream in the repository, bound to the workspace branch.

## Consequences

- An ADE turn's evidence, owner rules, skills, plan items, and workstream reach the repository's store, its resident, and the Hub, and survive retire.
- A worktree session never reads or clears the main checkout's current-workstream projection.
- Cursors such as the learned notice, the governance check, and the health appearance are shared by every checkout of a repository for now. Keying them per checkout is a follow-up.
- Post-turn outcome observation in a linked worktree stays unobserved until it can read the checkout's files and record into the repository. That is also a follow-up.

## Amendment, 2026-11-25: status commands and the first binding

The ADE 0.5.0 canary ran an agent in a workspace that checked its work with `lervo terminal status` and `lervo knowledge instruction capture`. Neither resolved both roots:

- The capture status read the checkout's empty queue, though the owner rule was queued in the repository.
- `lervo terminal status` opened a store in the checkout and read the workstream there. With no bindings in the checkout, the first read bound the workstream to `main`, found the workspace branch unbound, and cleared the checkout's projection. The agent's next workstream checkpoint restored it. Without that checkpoint, Stop would have found no workstream.

Those commands, and the coverage, budget, and attention reports, now resolve both roots. The first binding in a linked worktree is its own branch, so a read that still treats the checkout as its own repository fails on the history its store lacks, and never clears the projection.

## Verification

A test runs `lervo workstream start`, `lervo plan add`, a prompt, a workstream checkpoint, and Stop in a linked worktree of a registered repository. It shows:

- the workstream events and branch binding, the plan item, `terminal.context.prepared`, the owner-prompt capture, and `terminal.turn.observed` land in the repository;
- Stop finds the checkout's workstream checkpoint;
- the main checkout keeps its own projection;
- the worktree's store holds nothing.

A second test runs the status commands in the worktree. It shows that the capture status counts the repository's queue, `lervo terminal status` reports no workstream issue, the checkout keeps its projection, and only the repository holds bindings. A third shows that a single-root read binds the checkout's own branch and leaves the projection in place.

Resolver tests cover a subdirectory working directory, symbolic links, a project below the Git top level, an unregistered main checkout, a live worker, and a bare repository's worktree.
