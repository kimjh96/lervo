# ADR-0200: Natural-language terminal turn finalization

- Status: accepted
- Decision date: 2026-08-24

## Context

Codex and Claude terminal hooks prepared repository context and blocked stale knowledge, but advancing continuation state for every prompt manufactured history for read-only questions. Repository-changing turns also lacked a bounded statement that the working agent assessed canonical documentation, refreshed knowledge, or completed requested cross-provider deliberation. Users had to infer provider-specific bookkeeping commands.

Direct provider sessions remain `unmanaged`: Lervo can observe hook input boundaries, repository bytes, events, and explicit commands, but cannot prove provider reasoning. Enforcement covers observable repository invariants and does not treat agent declarations as proof of understanding.

[ADR-0327](hooks/0327-availability-safe-unmanaged-terminal-hooks.md) narrows enforcement for direct root sessions: finalization remains observable and reportable, but a non-current lifecycle no longer blocks provider completion. Managed execution and attached-worker isolation retain enforceable gates.

## Decision

`terminal.context.prepared` binds the repository revision captured before hook telemetry commits. `terminal.turn.observed` binds the before and after revisions and a derived changed flag, excluding runtime state under `.lervo/state`.

An unchanged turn may complete without creating or advancing a workstream or making a declaration. A changed turn must:

1. Leave repository knowledge, instruction bridges, normalization, layout, and lint current.
2. Create or advance the verified workstream through an `agent` event carrying the current `codex` or `claude` provider coordinate.
3. Invoke `lervo terminal declare` for the exact prepared observation after all repository changes.
4. Bind any declared cross-provider deliberation to a matching `deliberation.completed` event.

[ADR-0362](../../knowledge/repository/canonicalization/0362-bind-terminal-results-to-canonical-outcomes.md) extends the current declaration command with a required local canonicalization outcome. It binds every changed noncanonical source to exact changed canonical targets, a reviewable no-durable-change rationale, or a proposed Markdown draft. Summary and draft bodies remain outside the event payload.

`terminal.turn.declared` stores only an opaque declaration and context event ID, repository revision, task mode, canonicalization disposition, knowledge disposition, deliberation disposition, optional deliberation ID, and time. It stores no prompt, response, summary, path, document body, credential, or raw provider coordinate. The local candidate may store the bounded outcome and draft, but they are not event content or truth. The declaration is explicitly an unmanaged agent claim. Repository revision, exact outcome bindings, knowledge lifecycle, workstream state, and deliberation completion are checked independently; internal reasoning remains unsupported.

Injected context supplies exact provider-specific bookkeeping commands and bounded enum values. Users are never asked to run them. When task-level deliberation is requested, `lervo deliberate --auto --caller <provider>` selects, in order, the highest versioned `repository.default.vN` suite, the historical unversioned default, or exactly one non-pilot suite, then runs the existing managed two-provider workflow.

Current workstream snapshots may contain bounded `pendingDecisions` and `pendingApprovals`. These are unresolved current items, not an append-only decision log. A later agent treats a natural-language user reply as resolution input, removes the pending item after authorized application, and promotes durable outcomes to canonical documentation.

## Failure meaning

- A changed turn without an exact declaration, or whose declaration predates the current repository bytes, is blocked.
- Read-only dispositions are invalid for changed bytes.
- Pending approval dispositions block mutation completion and do not synthesize user authority.
- A deliberation outcome without a matching completed event is rejected.
- Ambiguous automatic verification-suite selection fails before providers start.
- A declaration proves only that the agent emitted the bounded claim and observable coordinates matched.

## Consequences

Ordinary questions no longer pollute continuation history. Repository changes cannot silently bypass continuation, knowledge, or requested-deliberation bookkeeping. Provider-specific mechanics remain behind generated context, and the evidence model remains honest about unmanaged execution.

Hub transport and cross-node workstream-body replication remain separate from this local turn contract.
