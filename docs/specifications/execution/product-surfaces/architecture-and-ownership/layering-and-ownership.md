# Layering and ownership

```text
Discord or first-party presentation
  -> surface adapter and renderer
  -> versioned product application commands, queries, and subscriptions
  -> work, organization, policy, knowledge, evidence, and verification domains
  -> explicit storage, provider, search, execution-target, and transport ports
```

Dependencies point inward. Domain packages never import Discord, UI, provider, database, or media implementations. Application composition may sequence domain decisions and ports but must not restate domain policy. Each adapter translates exactly one external boundary.

## Responsibility map

| Owner | Responsibilities | Must not own |
| --- | --- | --- |
| Core domains | Workstreams, goals, agents, roles, assignments, leases, authority, approvals, evidence, verification, deliberation convergence, canonical knowledge lifecycle, artifacts, source handoff, durable events | Discord rendering, UI state, provider-native behavior, search-index storage |
| Product application | Typed commands and queries, bounded orchestration, activity and operating projections, origin and deliberation correlation, idempotency, subscriptions, host capability negotiation | Parallel task, chat, deliberation, workflow, memory, or truth stores |
| Surface adapter | Native message normalization, channel and thread mapping, presentation, ephemeral typing or presence, attachment transport, native effect translation | Repository authority, deliberation convergence, semantic completion, hidden retries, provider execution policy |
| Projection adapters | Search indexes, activity views, unified-search fusion, operating views, notification state | Canonical source mutation or unsupported inference |
| External adapters | Provider, media/object storage, Discord, Hub, repository replica, optional search services | Core policy or fabricated evidence parity |

Canvas content begins as a collaboration artifact and becomes canonical repository documentation only through the existing reviewed knowledge lifecycle. Workflow presentation controls canonical assignment routines and execution graphs; it must not create a second workflow engine.

File and media bytes may reside in injected object storage. Lervo retains bounded content hashes, ownership, privacy, artifact relations, and observed delivery evidence.
