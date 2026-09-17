# Product boundaries and platform contracts

## Product construction boundary

A Paperclip-like product may present goals, projects, issues, routines, budgets, and an operating board over Lervo workstreams, agents, assignments, dependencies, approvals, verification, events, and observed usage.

A Buzz-like product may connect rooms, threads, mentions, and workflows to Lervo agent identity, inbox routing, assignments, handoffs, approval gates, deliberation, artifacts, and evidence. Sharing a room never grants repository authority.

The first production outbound Slack slice demonstrates this boundary: the host injects credential, private destination, artifact, permit, durable replay, and transport authorities; Lervo core sees only the reviewed assignment route and hashed evidence. This is connector infrastructure, not a decision to build a full chat interface.

The production local-improvement slice measures verification success and exact recurrence of a suite/non-passed-command signature from bounded canonical events. Products may present the observation; Lervo contracts govern raw evidence, attribution limits, review authority, and canonical mutation. Signature recurrence establishes neither root-cause identity nor autonomous model learning.

The installed CLI is the first explicit local observation host. A per-command `--local-events` grant may collect the two metrics, reverify an exact register, or observe apply. Ordinary planning and all other commands have no implicit measurement authority. Collection output is ephemeral and declares unestablished attribution and no canonical mutation.

Lervo should provide a minimal local reference surface for workstreams, graphs, blockers, approvals, verification, traces, and improvement candidates. It should not reproduce general chat, media, voice, forums, CRM, Git hosting, or every product-specific workflow.

## Existing graph foundations

Graph engineering extends implemented contracts:

- The event-derived knowledge and evidence graph connects runs, documents, roles, handoffs, verification, deliberation, artifacts, and knowledge lifecycle states.
- Reviewed semantic sidecars express bounded repository relations.
- Assignment dependencies, leases, path conflicts, and integration ordering form a constrained work DAG.
- Capability locks retain bounded acyclic dependency graphs.

Canonical events, documents, policies, and repository state remain authoritative. Graphs, indexes, operating boards, and search projections remain rebuildable. A future execution graph may declare intended transitions, but observed completion still requires current authority, events, exact state, and verification.

## Governed loops and execution graphs

```text
trigger -> load checkpoint -> managed attempt -> observe -> verify
        -> complete | retry | block | escalate
```

The workstream bounds the objective and continuation scope. An assignment is a work node; a managed run is one attempt; an agent is the executor; verification is the completion gate. Events plus CAS provide observable history and recovery.

Execution-graph v1 should extend the assignment DAG with versioned nodes, dependencies, bounded conditional transitions, parallel branches, joins, approval gates, handoffs, escalation, and cycle validation. Bounded local retries may occur within a node. Arbitrary graph cycles and agent-authored topology changes require later evidence.

Loops and graphs need not finish as infrastructure projects before product work. They provide shared implementation discipline for operating boards, routines, resumable work, collaboration routes, and verified improvement.

## Headless application contract

The versioned boundary for replaceable products must include:

- Typed commands for agent, assignment, approval, handoff, retry, suspend, and resume.
- Bounded queries for workstream, graph, blocker, verification, evidence, and improvement.
- Subscriptions to privacy-bounded lifecycle events.
- Content-bound plan/apply, idempotency, compatibility, and authorization coordinates.
- Provider, execution-target, capability, search, and surface adapter ports.
- Common contract tests preventing adapters from inventing authority or telemetry.

The CLI and minimal local reference client must use the same public contracts as external applications. No external surface may require internal database access, become necessary for local execution, or silently translate presentation state into repository authority.
