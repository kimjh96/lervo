# Platform evolution and refinement

## Evolution under rapid AI change

Extensibility is a product invariant: models, agent harnesses, context techniques, tool protocols, retrieval methods, evaluation practices, and product interfaces change rapidly.

| Stable core responsibility | Replaceable or additive edge |
| --- | --- |
| Repository source authority and ownership | Model and provider |
| Work, identity, policy, approval, and verification semantics | Agent harness and orchestration strategy |
| Evidence states and privacy meanings | Prompt and context-preparation technique |
| Content hashes, plans, events, and recovery | Search, retrieval, reranking, and compression adapter |
| Canonical knowledge and reviewed promotion | Skill, tool, MCP, plugin, and capability format |
| Local-first operation and explicit external authority | Execution target, host product, and UI |

Core packages must depend on provider-neutral contracts. Adapters translate external capabilities and telemetry into those contracts. Missing observations lower assurance; adapters cannot fabricate parity with other providers or techniques.

```text
observe a measured need or useful technique
  -> define a versioned port or bounded candidate
  -> validate compatibility, authority, privacy, and failure meaning
  -> run common contracts and paired evaluations
  -> review and explicitly activate
  -> observe outcomes
  -> retain rollback, supersession, and migration
```

Popularity, benchmark headlines, provider agreement, and model confidence do not authorize adoption. Each technique must disclose what it changes, observes, and exports; how it fails; and how the local baseline remains recoverable.

Versioning must support additive evolution and explicit migration without forcing old evidence to claim new semantics. Discover capabilities lazily, load them only when relevant, and activate them separately from selection or invocation. External and experimental behavior must fail closed rather than silently falling back or blending with another strategy.

## Refinement sequence

1. Complete the [foundation-hardening roadmap](../../roadmap/foundation-hardening.md), including causal work identity, public contract evolution, resource accounting, critical-path latency, failure recovery, and extension safety.
2. Map workstream, assignment, run, event, graph, and knowledge responsibilities to a stable public command, query, and event boundary.
3. Define governed-loop termination, retry, budget, escalation, checkpoint, and resume semantics without replacing current managed execution.
4. Add a bounded, versioned assignment execution graph over existing dependencies and verification gates.
5. Build the minimal local operating reference client and adapter development kit.
6. Add product routes for goals, routines, mentions, inboxes, threads, and connectors.
7. Complete verified improvement with candidate review and post-promotion effect measurement.
8. Add dynamic graphs, unattended autonomy, or external semantic systems only after measured need and explicit reviewed activation.

Every stage must deliver a usable vertical slice, reuse existing IDs, events, authority, and storage, and avoid parallel `workflow`, `task`, `memory`, or `truth` stores.

The roadmap target relative to the research entrypoint is `../roadmap/foundation-hardening.md`.

## Success conditions

- A local repository remains fully operable without a Hub or host product.
- A new UI or operating product can use public contracts without importing storage internals.
- A new provider, harness, tool protocol, or retrieval method can be added behind a versioned adapter without changing core evidence meanings.
- Current and historical runs remain interpretable as adapters and techniques evolve.
- Activation, rollback, migration, and failure remain observable and testable.
- Products may differ in interaction while sharing one repository work authority.
- Lervo can adopt useful AI advances without chasing trends or weakening assurance.
