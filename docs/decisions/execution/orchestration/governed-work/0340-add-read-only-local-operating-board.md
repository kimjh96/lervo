# ADR-0340: Add a read-only local operating board

- Status: `superseded`
- Decision date: 2026-09-02

Superseded by [ADR-0560](../../../foundation/0560-remove-unused-subsystems-to-harden-the-core.md). Lervo no longer ships this capability.

## Context

The provider-neutral governed-work report describes the current assignment graph, managed attempts, approvals, prepared completions, resource observations, and recommended next actions. Operators need an operating surface instead of raw JSON. A client that imports workforce or storage internals, owns a separate graph, or embeds mutations in its view would duplicate authority and bind future Paperclip-like and Buzz-like products to one implementation.

The first client must work without a configured Hub and must not broaden the privacy-bounded report for a richer interface. Objective prose, requests, paths, provider output, and inferred model use remain absent.

## Decision

Create the private `@lervo/operating-client` application package. It depends only on `@lervo/application-contract` and has three responsibilities:

1. Project one `GovernedWorkReportV1` into an operating-board view model.
2. Render the view as deterministic, self-contained HTML.
3. Expose one convenience composition of those pure operations.

The projection groups existing report evidence by assignment and retains graph topology, roots, joins, roles, priorities, statuses, lease observations, managed attempts, approval observations, prepared completion evidence, governed next actions, and exact resource-accounting groups. It neither evaluates new workflow policy nor reconstructs missing fields.

Add `lervo loop board` as the local composition route. The CLI performs the existing governed-work inspection and passes only its public report to the operating client. HTML is written to standard output so an operator can redirect it to a local file and open it in any browser. The route starts no server, makes no network request, imports no Hub code, and invokes no assignment, reconciliation, or provider mutation. An invalid governed report remains visible while preserving the nonzero exit status used by headless inspection.

The document uses inline style only, declares a restrictive content security policy, escapes all report-derived text, and contains no script, form, or control. Assignment dependencies link within the static document. The interface explicitly identifies itself as a read-only projection and lists its evidence limitations.

Repository state, events, CAS artifacts, assignments, verification results, and managed telemetry remain canonical. The board view and HTML are disposable projections. External clients consume the same application contract and may replace the presentation without importing this renderer.

## Privacy and failure meaning

The operating client receives no additional authority or data and displays only fields in the local governed-work report. HTML escaping prevents report metadata from becoming active markup. The content security policy prevents external loads and executable script; it does not claim sandboxing after user modification.

An absent attempt, approval, completion, or resource observation is shown as absent or unobserved evidence, never as success or zero. The board cannot infer an objective, provider work outside managed evidence, knowledge use, or approval authority. Rendering failure changes no repository state.

## Consequences

Lervo gains a minimal local graphical reference client while remaining headless at its authority boundary. Presentation, pure projection, governed policy, storage, and effects have separate change owners. Future desktop, web, Paperclip-like, or Buzz-like products can reuse the public report and command contracts while replacing the renderer or adding independently authorized routes.

The first board is deliberately read-only and report-bounded. Interactive plan/apply controls, goal and routine views, budgets, inboxes, mentions, threads, connectors, live refresh, and hosted collaboration require later contracts and decisions.

## References

- [Governed loop and assignment graph roadmap](../../../../roadmap/governed-loop-assignment-graph.md)
- [ADR-0336](0336-adopt-headless-governed-loop-and-assignment-graph.md)
- [ADR-0338](0338-reconcile-prepared-managed-assignment-completion.md)
- [System architecture](../../../../architecture/system.md)
- [Execution specification](../../../../specifications/execution.md)
