# Product-host report and authority contract

## Report contract

Each capability report contains:

- Protocol-matching `schemaVersion` and `kind: product_host.capabilities`.
- Protocol transport, version, discovery command, and `requiresHub: false`.
- Canonical authority classes products must not duplicate.
- Rebuildable projection classes products may render or transform.
- Ordered route descriptors with area, operation, stable result-contract identifier, command prefix, output, effect, authority, and availability.
- Explicit unsupported product capabilities.

Command arrays omit the executable name and repository-specific arguments. Products invoke installed `lervo`, add required route arguments, and request the declared output. Help text is human guidance, not machine discovery.

## Authority and state

Repository state, workstreams, assignments, leases, events, verification, and artifacts remain canonical. Assignment graphs, topology history, operating goals, governed decisions, operating boards, threads, inboxes, observed budgets, operating liveness, acknowledgments, agent context, and organization reports are rebuildable projections. Products may cache presentation state but must not turn it into assignment, topology, approval, completion, delivery, acknowledgment, liveness, context, or verification authority.

An `available` route can still reject missing roles, workstreams, assignments, leases, approvals, verification, resources, or repository state. Products must preserve its exit status and typed result, never converting an unavailable or invalid result into an empty success.

External connector effects remain unavailable in the stock CLI. Hosts injecting a connector must meet the separate descriptor, credential, destination, artifact, writing-permit, durable-reservation, unknown-effect, and common-conformance contracts.

## Unsupported capabilities

Versions 1–4 provide no product UI, product-owned task or chat database, unattended scheduler, dynamic graph mutation, implicit approval, or managed semantics for direct provider terminals. Protocol v5 adds only bounded unattended scheduling. Protocol v6 additionally permits reviewed additive topology changes; it still provides no product UI, product database, destructive graph rewiring or deletion, implicit approval, or managed semantics for direct provider terminals. Consumers must not infer broader authority from a successful query or render.

- v2 attention and goal reports add no inbox, goal store, acknowledgment, resolution, or scheduling authority.
- v3 liveness adds no process controller, polling, recovery, reassignment, or lease-release authority.
- v4's reviewed-input adapter is not a live Slack, Discord, webhook, or Hub receiver. Its acknowledgment route is not delivery, approval, assignment acceptance, provider execution, or completion evidence.
- v5 does not install a daemon, preempt an in-flight provider, apply cancellation, grant approval, reconcile uncertain completion automatically, or mutate graph topology.
- v6 does not start a provider, modify existing dependencies, delete nodes, permit cycles, create an independent graph store, or make topology review implicit.
- v7 does not make generated summaries canonical, infer context inheritance, create Discord applications, install bots, expose credentials, or merge project-team authority. Its organization-executive route performs only an exact policy-approved, allowlisted installed-adapter effect with durable replay; uncertain effects never retry automatically.
