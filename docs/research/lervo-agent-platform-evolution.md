# Lervo agent platform and evolution research

Status: `accepted input`

As of: 2026-09-03

## Objective

Define how Lervo can support Paperclip-like operating products, Buzz-like collaboration products, Prime- or Hermes-like execution agents, governed loops, and execution graphs without duplicating product interfaces or coupling the core to one generation of AI models and techniques.

This research does not authorize runtime behavior, reopen completed v0 scope, or require any named external product as a dependency.

## Platform conclusion

Lervo is a headless, local-first control plane and extension platform for durable, governed, verifiable repository-agent work. It owns work, authority, evidence, verification, knowledge, and recovery semantics. Host products own their audiences, interaction models, and presentation without creating another source of repository truth.

```text
operating and collaboration products
  -> versioned application adapters and read models
  -> Lervo work, policy, evidence, knowledge, loop, and graph contracts
  -> versioned provider and execution-target adapters
  -> interchangeable agents, models, tools, and workspaces
```

## Product construction boundary

A Paperclip-like product may present goals, projects, issues, routines, budgets, and an operating board over Lervo workstreams, agents, assignments, dependencies, approvals, verification, events, and observed usage.

A Buzz-like product may connect rooms, threads, mentions, and workflows to Lervo agent identity, inbox routing, assignments, handoffs, approval gates, deliberation, artifacts, and evidence. Sharing a room never grants repository authority.

The first production outbound Slack slice demonstrates this boundary: the host injects credential, private destination, artifact, permit, durable replay, and transport authorities; Lervo core sees only the reviewed assignment route and hashed evidence. This is connector infrastructure, not a decision to build a full chat interface in Lervo.

The production local-improvement slice measures verification success and exact recurrence of a suite/non-passed-command signature from bounded canonical events. Products may present the observation, but Lervo contracts govern raw evidence, attribution limits, review authority, and canonical mutation. Signature recurrence is neither root-cause identity nor autonomous model learning.

The installed CLI is the first explicit local observation host. A per-command `--local-events` grant may collect the two metrics, reverify an exact register, or observe apply. Ordinary planning and all other commands have no implicit measurement authority. Collection output is ephemeral and declares unestablished attribution and no canonical mutation.

Lervo should provide a minimal local reference surface for workstreams, graphs, blockers, approvals, verification, traces, and improvement candidates. It should not reproduce general chat, media, voice, forums, CRM, Git hosting, or every product-specific workflow.

## Existing graph foundations

Graph engineering extends implemented contracts:

- The event-derived knowledge and evidence graph connects runs, documents, roles, handoffs, verification, deliberation, artifacts, and knowledge lifecycle states.
- Reviewed semantic sidecars express bounded repository relations.
- Assignment dependencies, leases, path conflicts, and integration ordering form a constrained work DAG.
- Capability locks retain bounded acyclic dependency graphs.

Canonical events, documents, policies, and repository state remain authoritative; graphs, indexes, operating boards, and search projections remain rebuildable. A future execution graph may declare intended transitions, but observed completion still depends on current authority, events, exact state, and verification.

## Governed loops and execution graphs

```text
trigger -> load checkpoint -> managed attempt -> observe -> verify
        -> complete | retry | block | escalate
```

The workstream bounds the objective and continuation scope. An assignment is a work node, a managed run is one attempt, an agent is the executor, verification is the completion gate, and events plus CAS provide observable history and recovery.

Execution-graph v1 should extend the assignment DAG with versioned nodes, dependencies, bounded conditional transitions, parallel branches, joins, approval gates, handoffs, escalation, and cycle validation. Bounded local retries may occur within a node. Arbitrary graph cycles and agent-authored topology changes require later evidence.

Loops and graphs need not finish as infrastructure projects before product work. They are the shared implementation discipline for operating boards, routines, resumable work, collaboration routes, and verified improvement.

## Headless application contract

The versioned boundary for replaceable products must include:

- typed commands for agent, assignment, approval, handoff, retry, suspend, and resume;
- bounded queries for workstream, graph, blocker, verification, evidence, and improvement;
- subscriptions to privacy-bounded lifecycle events;
- content-bound plan/apply, idempotency, compatibility, and authorization coordinates;
- provider, execution-target, capability, search, and surface adapter ports; and
- common contract tests preventing adapters from inventing authority or telemetry.

The CLI and minimal local reference client must use the same public contracts as external applications. No external surface may require internal database access, become necessary for local execution, or silently translate presentation state into repository authority.

## Evolution under rapid AI change

Extensibility is a product invariant because models, agent harnesses, context techniques, tool protocols, retrieval methods, evaluation practices, and product interfaces change rapidly.

| Stable core responsibility | Replaceable or additive edge |
| --- | --- |
| Repository source authority and ownership | Model and provider |
| Work, identity, policy, approval, and verification semantics | Agent harness and orchestration strategy |
| Evidence states and privacy meanings | Prompt and context-preparation technique |
| Content hashes, plans, events, and recovery | Search, retrieval, reranking, and compression adapter |
| Canonical knowledge and reviewed promotion | Skill, tool, MCP, plugin, and capability format |
| Local-first operation and explicit external authority | Execution target, host product, and UI |

Core packages should depend on provider-neutral contracts. Adapters translate external capability and telemetry into those contracts. Missing observations lower assurance; adapters cannot fabricate parity with other providers or techniques.

```text
observe a measured need or useful technique
  -> define a versioned port or bounded candidate
  -> validate compatibility, authority, privacy, and failure meaning
  -> run common contracts and paired evaluations
  -> review and explicitly activate
  -> observe outcomes
  -> retain rollback, supersession, and migration
```

Popularity, benchmark headlines, provider agreement, and model confidence do not authorize adoption. Each new technique must disclose what it changes, observes, and exports; how it fails; and how the local baseline remains recoverable.

Versioning should support additive evolution and explicit migration without forcing old evidence to claim new semantics. Capabilities should be discovered lazily, loaded only when relevant, and activated separately from selection or invocation. External and experimental behavior should fail closed instead of silently falling back or blending with another strategy.

## Refinement sequence

1. Complete the [foundation-hardening roadmap](../roadmap/foundation-hardening.md), including causal work identity, public contract evolution, resource accounting, critical-path latency, failure recovery, and extension safety.
2. Map workstream, assignment, run, event, graph, and knowledge responsibilities to a stable public command, query, and event boundary.
3. Define governed-loop termination, retry, budget, escalation, checkpoint, and resume semantics without replacing current managed execution.
4. Add a bounded, versioned assignment execution graph over existing dependencies and verification gates.
5. Build the minimal local operating reference client and adapter development kit.
6. Add product routes for goals, routines, mentions, inboxes, threads, and connectors.
7. Complete verified improvement with candidate review and post-promotion effect measurement.
8. Add dynamic graphs, unattended autonomy, or external semantic systems only after measured need and explicit reviewed activation.

Each stage must deliver a usable vertical slice, reuse existing IDs, events, authority, and storage, and avoid parallel `workflow`, `task`, `memory`, or `truth` stores.

## Success conditions

- A local repository remains fully operable without a Hub or host product.
- A new UI or operating product can use public contracts without importing storage internals.
- A new provider, harness, tool protocol, or retrieval method can be added behind a versioned adapter without changing core evidence meanings.
- Current and historical runs remain interpretable as adapters and techniques evolve.
- Activation, rollback, migration, and failure remain observable and testable.
- Products may differ in interaction while sharing one repository work authority.
- Lervo can adopt useful AI advances without chasing trends or weakening assurance.

## Related research and authority

The [product positioning and verified improvement research](lervo-product-positioning-and-verified-improvement.md) owns the broader comparison and terminology. The [system architecture](../architecture/system.md), [product vision](../product/vision.md), [execution specification](../specifications/execution.md), and [repository knowledge specification](../specs/repository-knowledge-compilation.md) remain authoritative for implemented behavior.
