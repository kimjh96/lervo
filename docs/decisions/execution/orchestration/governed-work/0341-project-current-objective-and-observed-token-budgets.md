# ADR-0341: Project the current objective and observed token budgets

- Status: `accepted`
- Decision date: 2026-09-02

## Context

The first local operating board consumed only the privacy-bounded governed-work report. It showed assignment topology and managed evidence, but not the current workstream objective or next actions. It displayed resource observations without relating them to configured token admission limits. Paperclip-level operating visibility needs both without making UI state goal authority or representing observed tokens as money, billing, or a future reservation.

Routine execution is separate. A safe routine must instantiate an exact assignment template with role, capability, path, verification, approval, and concurrency bindings. Treating arbitrary recurring prompt text as a routine would bypass those owners.

## Decision

Add the version-1 `OperatingObjectiveReportV1` application shape. It projects the exact verified current workstream revision, status, title, objective, next actions, blockers, pending decisions, and pending approvals. The report is local operating prose, not execution telemetry. Its query coordinate is `operating_objective.inspect`. The CLI adapter opens project storage, verifies the current snapshot against its event and CAS artifact through the existing workstream boundary, and translates it. The application contract imports no storage or workstream implementation.

Add read-only `lervo loop objective` and `lervo loop budget` routes. The objective route neither inspects nor starts managed work. The budget route consumes the existing governed-work report and matches each configured token limit only to a resource observation with the same provider and accounting-descriptor hash. Complete evidence may yield observed remaining tokens, clamped at zero. Partial, unavailable, invalid, or absent evidence yields unknown observed and remaining values. Unlike accounting groups are never added or substituted.

Enrich `lervo loop board` by independently querying governed work and the objective through their public ports, then passing both reports to the operating client. The client retains separate pure objective, budget, board, HTML, and text presentation responsibilities. All report-derived prose is HTML-escaped. The board remains read-only and self-contained.

Do not add a price table, estimated cost, billed-cost claim, monetary warning, hard stop, routine store, scheduler, assignment-template mutation, or unattended trigger in this slice. Configured token limits retain their existing meaning: they prevent another governed attempt only when exact observed evidence reaches the threshold. They do not cap a provider call already running.

## Privacy and failure meaning

Objective reports may contain bounded workstream prose and belong only on authorized local application surfaces. They are not copied into execution events or the privacy-bounded governed-work report. Events retain only the existing snapshot coordinates and hashes.

`complete` resource evidence with a numeric total supports calculating an observed difference from an exact limit. `partial`, `unavailable`, `invalid`, and `unobserved` make the remaining amount unknown, never zero. `thresholdState: reached` means the observed total met the configured admission threshold; it does not mean money was spent, a bill was reconciled, or future work was reserved. A missing or invalid current workstream prevents the objective report and changes no state.

## Consequences

Operators and external clients can inspect the current objective and exact observed token limits through provider-neutral contracts. The local board becomes more useful without importing storage internals or weakening the evidence vocabulary. Goal prose, resource evidence, admission policy, presentation, and execution remain independently replaceable.

Exact assignment-template routines, monetary estimates, warnings and hard stops, collaboration threads, mentions, and inboxes remain later bounded scopes.

## References

- [Governed loop and assignment graph roadmap](../../../../roadmap/governed-loop-assignment-graph.md)
- [ADR-0340](0340-add-read-only-local-operating-board.md)
- [Recommended Paperclip operating model](../../../../research/paperclip-lervo-comparison/recommendations/operating-model.md)
- [Execution specification](../../../../specifications/execution.md)
