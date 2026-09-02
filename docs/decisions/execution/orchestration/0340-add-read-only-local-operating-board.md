# ADR-0340: Add a read-only local operating board

- Status: `accepted`
- Decision date: 2026-09-02

## Context

The provider-neutral governed-work report can already describe the current assignment graph,
managed attempts, approvals, prepared completions, resource observations, and recommended next
actions. Operators still need to read that evidence as an operating surface rather than raw JSON.
A client that imports workforce or storage internals, owns a separate graph, or embeds mutations in
its view would duplicate authority and make future Paperclip-like and Buzz-like products depend on
one implementation.

The first client must remain useful when no Hub is configured. It also must not broaden the
privacy-bounded report merely to make the interface appear richer: objective prose, requests,
paths, provider output, and inferred model use are deliberately absent.

## Decision

Create the private `@lervo/operating-client` application package. It depends only on
`@lervo/application-contract` and has three bounded responsibilities:

1. project one `GovernedWorkReportV1` into an operating-board view model;
2. render that view as deterministic, self-contained HTML; and
3. expose one convenience composition of those two pure operations.

The projection groups existing report evidence by assignment and retains graph topology, roots,
joins, roles, priorities, statuses, lease observations, managed attempts, approval observations,
prepared completion evidence, governed next actions, and exact resource-accounting groups. It
does not evaluate new workflow policy or reconstruct missing fields.

Add `lervo loop board` as the local composition route. The CLI performs the existing governed-work
inspection and passes only its public report to the operating client. HTML goes to standard output,
so an operator may redirect it to a local file and open it with any browser. The route starts no
server, performs no network request, imports no Hub code, and invokes no assignment, reconciliation,
or provider mutation. An invalid governed report remains visible but preserves the nonzero exit
status used by headless inspection.

The document contains inline style only, declares a restrictive content security policy, escapes
all report-derived text, and includes no script, form, or control. Assignment dependencies link
within the static document. The interface explicitly labels itself a read-only projection and
lists its evidence limitations.

Repository state, events, CAS artifacts, assignments, verification results, and managed telemetry
remain canonical. The board view and HTML are disposable projections. External clients should
consume the same application contract and may replace the presentation without importing this
renderer.

## Privacy and failure meaning

The operating client receives no additional authority or data. It displays only fields already
present in the local governed-work report. HTML escaping prevents report metadata from becoming
active markup. The content security policy prevents external loads and executable script; the
document does not claim sandboxing when a user modifies it after generation.

An absent attempt, approval, completion, or resource observation is rendered as absent or
unobserved evidence, never success or zero. The board cannot infer an objective, provider work
outside managed evidence, knowledge use, or approval authority. Rendering failure changes no
repository state.

## Consequences

Lervo now has a minimal local graphical reference client while remaining headless at its authority
boundary. Presentation, pure projection, governed policy, storage, and effects have separate change
owners. Future desktop, web, Paperclip-like, or Buzz-like products can reuse the public report and
command contracts while replacing the renderer or adding independently authorized routes.

The first board is deliberately read-only and report-bounded. Interactive plan/apply controls,
goal and routine views, budgets, inboxes, mentions, threads, connectors, live refresh, and hosted
collaboration require later contracts and decisions.

## References

- [Governed loop and assignment graph roadmap](../../../roadmap/governed-loop-assignment-graph.md)
- [ADR-0336](0336-adopt-headless-governed-loop-and-assignment-graph.md)
- [ADR-0338](0338-reconcile-prepared-managed-assignment-completion.md)
- [System architecture](../../../architecture/system.md)
- [Execution specification](../../../specifications/execution.md)
