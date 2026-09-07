# Assignment routines and governed triggers

## Scope

An assignment routine is a content-bound template for materializing the existing workforce assignment graph, not a prompt runner, provider command, scheduler, daemon, cron service, webhook transport, or second task store. Version 1 accepts an explicit local `manual` trigger or an in-process `authenticated_live` trigger admitted by the live-trigger authority contract. It ends after assignment state and `assignment.created` evidence commit.

Responsibilities:

- The storage-free application contract owns template, trigger, plan, step, and receipt shapes.
- The work controller validates and expands templates without effects.
- Agent workforce owns deterministic assignment identity, state, role and capability enforcement, locking, and event rollback.
- The CLI reads requests, verifies the current workstream, resolves current role contracts, records workforce events, and exposes exact plan/apply.

## Template and trigger

A version-1 template binds:

- A bounded routine ID and semantic template version.
- A `skip_if_active`, `coalesce_if_active`, or `enqueue_bounded` concurrency policy.
- One to 32 acyclic nodes, each with a stable node key.
- Task type, exact role version and contract hash, and nullable required capability hash.
- Priority, template-local dependencies, acceptance criteria, verification suites, approval requirements, and expected paths.
- At most 16 active instances for bounded enqueue; skip and coalesce require exactly one.

A manual trigger binds a request digest, idempotency-key digest, and observed time, with no prompt or command. The same project, workstream, template content, and idempotency key produce the same invocation and assignment IDs. Observation time contributes to trigger evidence and plan identity, but not invocation identity, so retries can retain the original key without creating another invocation.

An authenticated-live trigger also binds adapter ID and version, descriptor hash, source ID, authorization hash, and authentication-receipt hash. Only the live-trigger application may supply its matching admission plan in process. A request file carrying this discriminator has no authority and is rejected by the public materialization command.

## Planning and concurrency

Planning validates the entire template before resolving current role contracts. It computes template, trigger, and assignment-snapshot hashes; topologically orders nodes; replaces node-key dependencies with deterministic assignment IDs; and returns only bounded coordinates and digests. Acceptance, approval, and path prose remain in local input and are excluded from the printable plan.

An invocation is active if at least one routine assignment is `queued`, `leased`, or `blocked`:

- `skip_if_active` returns `skipped` without associating the new trigger with the active invocation.
- `coalesce_if_active` returns the one exact related invocation.
- `enqueue_bounded` admits another invocation only below the template limit.

Multiple active invocations under skip or coalesce are invalid; they must not be selected heuristically.

The routine materialization lock serializes routine apply operations. Apply rebuilds the plan under this lock and requires the exact plan ID. Ordinary assignment creation retains its scheduler lock; capacity is rechecked for every node. The routine lock provides transient coordination, not durable routine state or scheduling authority.

## Materialization and recovery

Each planned node delegates to the existing workforce assignment transition, which re-resolves the role contract, checks the optional required capability hash format, verifies current dependencies and capacity, writes one assignment, and commits one `assignment.created` event with rollback on event failure. A later claim requires the assignee's current capability hash to equal any non-null assignment requirement.

Multi-node apply is convergent, not atomic. Successful earlier assignment events are never rewritten when a later node fails. Deterministic IDs make exact replay idempotent. The next plan validates every existing node against template materialization and returns `resume` with only missing nodes.

A collision, changed node, stale role binding, changed assignment snapshot, foreign workstream, cycle, capacity exhaustion, or concurrency conflict blocks mutation. Routine apply never starts a provider, so no uncertain effect is retried as provider work.

## Canonical state and privacy

Manual routine definitions remain explicit, user-owned request files; authenticated-live templates remain inside owner-only authorization. Assignment state stores nullable required capability and routine provenance: routine ID, template version and hash, invocation ID, trigger kind and digest, and node key. This is assignment provenance, not a routine execution log. Assignments and workforce events remain canonical; plans, graphs, and concurrency views are rebuildable.

Events and printable plans exclude template bodies, acceptance prose, approval text, repository paths, prompts, provider output, reasoning, credentials, and arbitrary external identifiers. `assignment.created` adds only nullable capability and routine coordinates plus digests. Missing routine provenance on historical assignments means ordinary creation, not a failed or inferred routine.

## Capability limits

Version 1 provides no timer, cron, Hub wakeup, automatic claim, provider selection, managed-run start, approval grant, cancellation, or delivery claim. The separate authenticated-live contract owns webhook transport and recovery. A `completed` materialization receipt proves only assignment and event creation. Execution remains a separate manual governed-loop action under lease, approval, verification, resource, and recovery contracts.

## References

- [Governed loop roadmap](../../roadmap/governed-loop-assignment-graph.md)
- [Headless governed loop](../../decisions/execution/orchestration/governed-work/0336-adopt-headless-governed-loop-and-assignment-graph.md)
- [Assignment authority](../../decisions/execution/orchestration/governed-work/0337-bind-assignment-approval-and-cancellation-authority.md)
- [Execution events and privacy](events-and-privacy.md)
- [Authenticated live triggers](authority-and-repository/authenticated-live-triggers.md)
