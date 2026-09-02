# Lervo agent platform and evolution research

Status: `accepted input`

As of: 2026-09-02

## Objective

Define how Lervo can support Paperclip-like operating products, Buzz-like collaboration
products, Prime- or Hermes-like execution agents, governed loops, and execution graphs
without duplicating product interfaces or coupling the core to one generation of AI
models and techniques.

This document records research direction. It does not authorize runtime behavior,
reopen completed v0 scope, or make any named external product a required dependency.

## Platform conclusion

Lervo is a headless, local-first control plane and extension platform for durable,
governed, and verifiable agent work in repositories.

It should expose repository-agent primitives and stable application contracts from which
operators can build different products. Lervo owns work, authority, evidence,
verification, knowledge, and recovery semantics. A host product owns its audience,
interaction model, and presentation without creating a second source of repository
truth.

```text
operating and collaboration products
  -> versioned application adapters and read models
  -> Lervo work, policy, evidence, knowledge, loop, and graph contracts
  -> versioned provider and execution-target adapters
  -> interchangeable agents, models, tools, and workspaces
```

## Product construction boundary

A Paperclip-like product can present goals, projects, issues, routines, budgets, and an
operating board over Lervo workstreams, agents, assignments, dependencies, approvals,
verification, events, and observed usage.

A Buzz-like product can connect rooms, threads, mentions, and workflows to Lervo agent
identity, inbox routing, assignments, handoffs, approval gates, deliberation, artifacts,
and evidence. Sharing a room never grants repository authority.

The first production outbound slice now demonstrates that boundary for Slack: the host injects
credential, private destination, artifact, permit, durable replay, and transport authorities while
Lervo core sees only the reviewed assignment route and hashed evidence. This is connector
infrastructure for Buzz-like products, not a decision to build their full chat interface inside
Lervo.

The production local improvement slice now measures both verification success and exact recurrence
of a suite/non-passed-command signature from bounded canonical events. It preserves the same
platform boundary: products may present the observation, while raw evidence, attribution limits,
review authority, and canonical mutation remain governed by Lervo contracts. Signature recurrence
is not presented as root-cause identity or autonomous model learning.

Lervo should supply a minimal local reference surface for workstreams, graphs, blockers,
approvals, verification, traces, and improvement candidates. It should not reproduce
general chat, media, voice, forums, CRM, Git hosting, or every product-specific workflow.

## Existing graph foundations

Graph engineering starts from implemented contracts rather than a new graph authority:

- the event-derived knowledge and evidence graph connects runs, documents, roles,
  handoffs, verification, deliberation, artifacts, and knowledge lifecycle states;
- reviewed semantic sidecars express bounded repository relations;
- assignment dependencies, leases, path conflicts, and integration ordering form a
  constrained work DAG; and
- capability locks retain bounded acyclic dependency graphs.

Canonical events, documents, policies, and repository state remain authoritative.
Graphs, indexes, operating boards, and search projections remain rebuildable. A future
execution graph may declare intended transitions, but observed completion still comes
from current authority, events, exact state, and verification.

## Governed loops and execution graphs

A governed loop aligns existing primitives:

```text
trigger -> load checkpoint -> managed attempt -> observe -> verify
        -> complete | retry | block | escalate
```

The workstream is the bounded objective and continuation scope. An assignment is a work
node, a managed run is one attempt, an agent is the executor, verification is the
completion gate, and events plus CAS provide observable history and recovery.

Execution-graph v1 should extend the existing assignment DAG with versioned nodes,
dependencies, bounded conditional transitions, parallel branches, joins, approval gates,
handoffs, escalation, and cycle validation. Local bounded retries may occur inside a
node; arbitrary graph cycles and agent-authored topology changes require later evidence.

Loops and graphs are not infrastructure projects that must finish before product work.
They are the common implementation discipline through which operating boards, routines,
resumable work, collaboration routes, and verified improvement gain consistent state.

## Headless application contract

Replaceable products need a versioned boundary containing:

- typed commands for agent, assignment, approval, handoff, retry, suspend, and resume;
- bounded queries for workstream, graph, blocker, verification, evidence, and improvement;
- subscriptions to privacy-bounded lifecycle events;
- content-bound plan/apply, idempotency, compatibility, and authorization coordinates;
- provider, execution-target, capability, search, and surface adapter ports; and
- common contract tests that prevent an adapter from inventing authority or telemetry.

The CLI and a minimal local reference client must consume the same public contracts that
external applications consume. No external surface may require internal database access,
become necessary for local execution, or silently translate presentation state into
repository authority.

## Evolution under rapid AI change

Lervo must remain flexible as models, agent harnesses, context techniques, tool
protocols, retrieval methods, evaluation practices, and product interfaces change.
Extensibility is therefore a product invariant, not an optional integration feature.

| Stable core responsibility                                   | Replaceable or additive edge                          |
| ------------------------------------------------------------ | ----------------------------------------------------- |
| Repository source authority and ownership                    | Model and provider                                    |
| Work, identity, policy, approval, and verification semantics | Agent harness and orchestration strategy              |
| Evidence states and privacy meanings                         | Prompt and context-preparation technique              |
| Content hashes, plans, events, and recovery                  | Search, retrieval, reranking, and compression adapter |
| Canonical knowledge and reviewed promotion                   | Skill, tool, MCP, plugin, and capability format       |
| Local-first operation and explicit external authority        | Execution target, host product, and UI                |

Core packages should depend on provider-neutral contracts. Adapters translate external
capability and telemetry into those contracts. A missing observation lowers assurance;
an adapter cannot fabricate parity with another provider or technique.

New AI techniques should enter through a controlled evolution lifecycle:

```text
observe a measured need or useful technique
  -> define a versioned port or bounded candidate
  -> validate compatibility, authority, privacy, and failure meaning
  -> run common contracts and paired evaluations
  -> review and explicitly activate
  -> observe outcomes
  -> retain rollback, supersession, and migration
```

Popularity, a benchmark headline, provider agreement, or model confidence does not
authorize adoption. A new technique must expose what it changes, what it observes, what
it exports, how it fails, and how the local baseline remains recoverable.

Versioning should permit additive evolution and explicit migration without forcing old
evidence to claim new semantics. Capabilities should be discovered lazily, loaded only
when relevant, and activated separately from selection or invocation. External and
experimental behavior should fail closed rather than silently falling back or blending
with another strategy.

## Refinement sequence

The recommended order is:

1. Complete the planned [foundation-hardening roadmap](../roadmap/foundation-hardening.md),
   including causal work identity, public contract evolution, resource accounting,
   critical-path latency, failure recovery, and extension safety.
2. Map existing workstream, assignment, run, event, graph, and knowledge responsibilities
   to a stable public command, query, and event boundary.
3. Define governed-loop termination, retry, budget, escalation, checkpoint, and resume
   semantics without replacing current managed execution.
4. Add a bounded versioned assignment execution graph over existing dependencies and
   verification gates.
5. Build the minimal local operating reference client and adapter development kit.
6. Add product routes for goals, routines, mentions, inboxes, threads, and connectors.
7. Complete the verified-improvement loop with candidate review and post-promotion effect
   measurement.
8. Add dynamic graphs, unattended autonomy, or external semantic systems only after
   measured need and explicit reviewed activation.

Each stage must deliver a usable vertical slice and reuse existing IDs, events, authority,
and storage. It must not create parallel `workflow`, `task`, `memory`, or `truth` stores.

## Success conditions

- A local repository remains fully operable without a Hub or host product.
- A new UI or operating product can use public contracts without importing storage internals.
- A new provider, harness, tool protocol, or retrieval method can be added behind a
  versioned adapter without changing core evidence meanings.
- Current and historical runs remain interpretable after adapters and techniques evolve.
- Activation, rollback, migration, and failure are observable and testable.
- Products can differ in interaction while sharing one repository work authority.
- Lervo can adopt useful AI advances without chasing trends or weakening assurance.

## Related research and authority

The [product positioning and verified improvement research](lervo-product-positioning-and-verified-improvement.md)
owns the broader comparison and terminology. The [system architecture](../architecture/system.md),
[product vision](../product/vision.md), [execution specification](../specifications/execution.md),
and [repository knowledge specification](../specs/repository-knowledge-compilation.md)
remain authoritative for implemented behavior.
