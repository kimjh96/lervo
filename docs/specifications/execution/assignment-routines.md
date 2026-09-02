# Assignment routines and manual triggers

## Scope

An assignment routine is a content-bound template for materializing the existing workforce
assignment graph. It is not a prompt runner, provider command, scheduler, daemon, cron service,
webhook, or second task store. Version 1 accepts only an explicit local `manual` trigger and ends
after assignment state and `assignment.created` evidence commit.

The storage-free application contract owns the template, trigger, plan, step, and receipt shapes.
The work controller validates and expands the template without effects. Agent workforce owns
deterministic assignment identity, state, role and capability enforcement, locking, and event
rollback. The CLI reads the request, verifies the current workstream, resolves current role
contracts, records workforce events, and exposes exact plan/apply.

## Template and trigger

A version-1 template binds:

- a bounded routine ID and semantic template version;
- `skip_if_active`, `coalesce_if_active`, or `enqueue_bounded` concurrency policy;
- one to 32 acyclic nodes, each with a stable node key;
- task type, exact role version and contract hash, and nullable required capability hash;
- priority, template-local dependencies, acceptance criteria, verification suites, approval
  requirements, and expected paths; and
- at most 16 active instances for bounded enqueue; skip and coalesce require exactly one.

The manual trigger binds a request digest, idempotency-key digest, and observed time. It contains no
prompt or command. The same project, workstream, template content, and idempotency key produce the
same invocation and assignment IDs. Observation time remains part of trigger evidence and plan
identity but not invocation identity, so a retry can retain the original key without creating a
second invocation.

## Planning and concurrency

Planning validates the entire template before resolving current role contracts. It computes the
template, trigger, and assignment-snapshot hashes, topologically orders nodes, replaces node-key
dependencies with deterministic assignment IDs, and returns only bounded coordinates and digests.
Acceptance, approval, and path prose stay in the local input and are absent from the printable plan.

An active invocation has at least one `queued`, `leased`, or `blocked` routine assignment.
`skip_if_active` returns `skipped` without associating the new trigger with the active invocation.
`coalesce_if_active` returns the one exact related invocation. `enqueue_bounded` admits another
invocation only below the template limit. Multiple active invocations under skip or coalesce are
invalid rather than selected heuristically.

The routine materialization lock serializes routine apply operations. Apply rebuilds the plan under
that lock and requires the exact plan ID. Ordinary assignment creation retains its scheduler lock;
capacity is rechecked on every node. The routine lock is transient coordination, not durable routine
state or scheduling authority.

## Materialization and recovery

Each planned node delegates to the existing workforce assignment transition. The transition
re-resolves the role contract, checks the optional required capability hash format, verifies current
dependencies and capacity, writes one assignment, and commits one `assignment.created` event with
rollback on event failure. Claim later requires the assignee's current capability hash to equal a
non-null assignment requirement.

Multi-node apply is convergent, not falsely atomic. Successful earlier assignment events are never
rewritten if a later node fails. Deterministic IDs make exact replay idempotent. The next plan
validates every existing node against template materialization and returns `resume` with only missing
nodes. A collision, changed node, stale role binding, changed assignment snapshot, foreign
workstream, cycle, capacity exhaustion, or concurrency conflict blocks mutation. No uncertain
effect is retried as provider work because routine apply never starts a provider.

## Canonical state and privacy

Routine definitions remain explicit user-owned request files. Assignment state stores nullable
required-capability and routine provenance: routine ID, template version and hash, invocation ID,
manual trigger digest, and node key. This is assignment provenance, not a routine execution log.
Assignments and workforce events remain canonical; plans, graphs, and concurrency views are
rebuildable.

Events and printable plans exclude template bodies, acceptance prose, approval text, repository
paths, prompts, provider output, reasoning, credentials, and arbitrary external identifiers.
`assignment.created` adds only nullable capability and routine coordinates plus digests. Missing
routine provenance on historical assignments means ordinary creation, not a failed or inferred
routine.

## Capability limits

Version 1 provides no timer, cron, webhook, Hub wakeup, external connector, automatic claim,
provider selection, managed-run start, retry, approval grant, cancellation, or delivery claim. A
`completed` materialization receipt proves assignment and event creation only. Execution remains a
separate manual governed-loop action under leases, approval, verification, resource, and recovery
contracts.

## References

- [Governed loop roadmap](../../roadmap/governed-loop-assignment-graph.md)
- [Headless governed loop](../../decisions/execution/orchestration/0336-adopt-headless-governed-loop-and-assignment-graph.md)
- [Assignment authority](../../decisions/execution/orchestration/0337-bind-assignment-approval-and-cancellation-authority.md)
- [Execution events and privacy](events-and-privacy.md)
