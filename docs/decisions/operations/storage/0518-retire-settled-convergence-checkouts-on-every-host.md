# ADR-0518: Retire settled convergence checkouts on every host

Status: `accepted`
Decision date: 2026-10-14
Amends: [ADR-0219](0219-typed-derived-state-retention.md)

Amended by: [ADR-0534](0534-bound-installed-runtimes-and-convergence-artifacts.md)

## Context

Repository knowledge convergence provisions one Git worktree per assignment and lease generation under `.lervo/state/knowledge/convergence-workspaces/`. Each checkout carries the repository's dependencies, so a checkout is 0.6 to 1 GB. Retention removed a checkout only through the exact cleanup plan, which requires an integrated workspace whose sealed head is reachable from the current integration target. On 2026-10-14 the six hosted repositories held 87 checkouts that could never qualify, about 36 GB:

- Failed attempts left their checkout `active` with a writer session. Nothing ever moved it on, and the cleanup plan refuses anything that is not integrated. flemo alone held 43 such checkouts after one integration exhausted its 16 attempts. Each attempt failed because verification rewrote `pnpm-lock.yaml`, so 40 checkouts were also dirty.
- ADR-0482 absorption moves the integration ref to the base branch after a squash merge. The sealed heads of already-integrated checkouts are then reachable only from the absorbed backup tip, so the plan reported `head_unreachable` indefinitely.
- Retention also required the current delegation hash, and it ran only on the convergence owner. A delegation renewal therefore stranded older checkouts, and a host that lost ownership never cleaned its own.

`lervo state prune` could not reclaim the space either. Its inventory walked into these worktrees, met pnpm's `node_modules` symbolic links, and rejected the whole plan.

## Decision

- Each cycle retires up to eight convergence checkouts. A checkout qualifies when its record is the exact private path for its assignment, lease generation, and execution kind, and one of these holds:
  - `obligation_settled`: the obligation recorded its terminal `repository.knowledge.convergence.recorded` event and the assignment holds no lease.
  - `assignment_closed`: the assignment is `cancelled`, or `failed` after its final permitted attempt, and holds no lease.
  - `lease_superseded`: the checkout never sealed and a later lease generation replaced it.
- Retirement does not need target reachability or the current delegation. A failed attempt that can still be reopened keeps its checkout until a new lease replaces it, and a sealed checkout of an open obligation stays for a resumed integrator.
- Retirement first moves the record to `recovery_required` with recovery reason `convergence_retirement`, clearing the writer session. It then removes the worktree with `git worktree remove --force` through the Git adapter's marker-checked `removeDiscardingChanges`, and records `removed`. The two workspace events use deterministic IDs and the retirement reason as `reasonCode`. They carry only the existing opaque workspace coordinates. A rerun resumes from the fenced record. A marker mismatch or an in-progress Git operation leaves the checkout untouched and fenced, and a later cycle retries.
- Discarding uncommitted bytes is safe here, because a seal binds only committed bytes, and only Lervo writes under this private root. The sealed result, drafts, and verification results remain in CAS.
- Checkouts and their records are host-local. A host that does not own convergence still retires its own checkouts under the repository's knowledge worker lock, taking the lock only when it has something to retire.
- Cleanups journaled by earlier releases still finish through exact journal recovery.
- `lervo state prune` excludes `knowledge/convergence-workspaces/` from its inventory. Those worktrees belong to the workspace lifecycle, and deleting their files would strand registered Git worktrees.

## Consequences

Failed, cancelled, superseded, and settled convergence checkouts no longer accumulate. On the six hosted repositories, retention releases the 87 stranded checkouts at eight per cycle. A long retry chain keeps at most its current and previous checkout. `lervo state prune` works again in repositories with live convergence checkouts.

This decision does not fix the lockfile rewrite behind flemo's failure loop. That remains a repository verification issue.

## Verification

- Decision-table tests cover all three retirement reasons, and the checkouts a later effect can still read.
- Runtime tests cover a non-owner host retiring integrated checkouts after the target moved away from their heads.
- A runtime test covers a failed integrator attempt whose dirty checkout is retired once its obligation settles.
- Git adapter tests cover forced removal with marker checking.
- A state-retention test covers a prune plan beside a convergence worktree that contains a symbolic link.
