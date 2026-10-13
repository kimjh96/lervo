# ADR-0512: Keep convergence workers out of owner headcount, and retire superseded ones

Status: `accepted`
Decision date: 2026-10-13
Amends: [ADR-0454](0454-open-multi-responder-rooms-and-natural-staffing.md)

## Context

After its preflight block was resolved, the axli standing supervision immediately requested attention with `worker_capacity_exceeded`. The repository had 19 active agents against the mandate's `maximumWorkers` of 5:

- the owner;
- 4 staff it had hired (6 hired, 2 since retired);
- 14 agents named `Knowledge <role> <delegation hash>`.

Repository knowledge convergence hires one worker per role (generator, reviewer, writer, integrator) under the convergence delegation's parent, named by the delegation's content hash. Each delegation renewal hires a fresh set, and nothing retired the previous one. Across four delegations, 10 of the 14 served delegations that no longer existed.

Supervision admission counted every active agent in the repository. Under ADR-0454, `maximumWorkers` bounds the product owner's own staffing within its mandate. Convergence workers act under a separately reviewed convergence delegation, whose fixed roles already bound them. Counting them let background knowledge maintenance consume the owner's operating headcount. Once the count exceeded the bound, every supervision plan was refused, including allocations that add no worker.

## Decision

- `convergence-roster.ts` in `@lervo/repository-knowledge-runtime` owns convergence worker identity:
  - `convergenceAgentName` is the single naming rule that hiring uses.
  - A worker is a convergence worker only when three conditions hold: its name matches that rule, its parent is the delegation's parent, and its role is the delegation's binding for that role.
- Before each convergence assignment, `retireSupersededConvergenceAgents` retires convergence workers of other delegation hashes. A worker with a lease or with a queued, leased or blocked assignment is kept until a later call. Each retirement records `agent.status.changed`.
- Supervision admission and workforce observation count active agents through `countSupervisionStaff`. It excludes the convergence workers of the repository's current delegation document. An unreadable delegation excludes nobody, so doubt never lowers the count.

## Consequences

axli's count falls from 19 to 5: the owner and its 4 remaining staff, with its 4 current convergence workers outside the count. The superseded convergence workers retire at the next convergence assignment. The owner can again allocate existing staff; a further hire still exceeds `maximumWorkers` and goes to the owner, as ADR-0454 requires.
