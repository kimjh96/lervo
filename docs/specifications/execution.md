# Lervo Execution and Evidence Specification

Status: `active`
As of: 2026-09-16

Defines provider-neutral managed execution and evidence contracts. ADRs retain rationale.

## Contract topics

- [Managed lifecycle and context evidence](execution/lifecycle-and-context.md): lifecycle, direct hooks, continuation, E0–E4, roles, eligibility, and coverage.
- [Context quality across product surfaces](execution/context-quality.md): shared preparation, exact sections, outcome observations and event compatibility are implemented in source. Reviewed quality, resource qualification and installed acceptance remain open.
- [Authority and repository changes](execution/authority-and-repository.md): capabilities, approvals, snapshots, assignments, verification, knowledge, and publication.
- [Operations and recovery](execution/operations-and-recovery.md): events, privacy, durable apply, remote execution, failures, and required verification.

## Related specifications

- [Outcome supervision](execution/outcome-supervision.md): accountable continuation, autonomous staffing, artifact acceptance, and central escalation; implementation remains required.
- [Typed semantic grounding](execution/semantic-grounding.md): precedes selection and effects.
- [Managed linked evidence](execution/managed-linked-evidence-canary.md): historical record of the default-off canary and shadow, removed by [ADR-0528](../decisions/search/activation/0528-remove-the-linked-evidence-canary-and-shadow.md).
- [Capability packages](execution/capabilities.md): skills, MCP servers, plugins, and bundles.
- [Provider adapters](execution/provider-adapters.md): provider-specific configuration, terminal integration, usage normalization, publication evaluation, and result projection. Codex and Claude share provider-neutral contracts without invented telemetry.
- Repository assignments: [interactions](execution/assignment-interactions.md).
- [Governed loop roadmap](../roadmap/governed-loop-assignment-graph.md): delivery history. [ADR-0560](../decisions/foundation/0560-remove-unused-subsystems-to-harden-the-core.md) removed the governed loop, `lervo loop`, and the product-host protocol.
- [Repository knowledge compilation](../specs/repository-knowledge-compilation.md): owns scanner, taxonomy, normalization bounds, caching, retry, publication, durable apply, lifecycle, skill, entrypoint, agent-surface, and recovery details.
- [State lifecycle](execution/state-lifecycle.md): durable local data and rebuildable projections.
- [Events and privacy](execution/events-and-privacy.md): owns event contracts, reader compatibility, writer activation, and failure codes.
- [Stage observation and performance](execution/stage-observation-and-performance.md): timing, environment, projection, and performance gates.
- [Bounded dynamic assignment topology](execution/dynamic-assignment-topology.md): additive branch-and-join changes, exact review, graph bounds, interruption recovery, migration, and historical replay.
- [Adverse-condition safety](execution/adverse-condition-safety.md): common effect inventory, exact completion/rollback/recovery projection, cancellation and backpressure bounds, telemetry field registry, threat model, capacity and retention profiles, and compatibility rehearsals.
- [Hub and Node coordination](coordination/hub-and-node.md): remote coordination.
- [Conflict-safe repository replica continuation](../decisions/coordination/sync/0396-conflict-safe-repository-replica-continuation.md): exact uncommitted Mac/WSL source handoff, bidirectional compare-and-swap, readiness receipts, and native-work completion enforcement.
- [Open collaboration platform](../decisions/foundation/0452-open-collaboration-by-default-with-authority-at-consequential-effects.md): open-by-default edges over a hardened core, authority at consequential effects, core robustness mechanisms, the measurement contract (ADR-0459), and completion labels; delivery in [the platform roadmap](../roadmap/open-collaboration-platform.md).
- [Product surfaces](execution/product-surfaces.md): Discord-visible installed acceptance, future first-party host parity, responsibility separation, unified search, canonicalization, observability, and compatibility.

## References

- [System architecture](../architecture/system.md)
- [v0 roadmap](../roadmap/v0.md)
- [Managed run lifecycle ADR](../decisions/execution/providers/0011-managed-provider-run-lifecycle.md)
- [Signed approval ADR](../decisions/execution/verification/0044-signed-approval-managed-write-permit.md)
- [Repository knowledge ADR](../decisions/knowledge/repository/0170-evidence-bound-repository-knowledge-compilation.md)
- [Bounded publication ADR](../decisions/knowledge/repository/0190-language-aware-bounded-repository-publication.md)
- [Resource and performance budgets](execution/resource-and-performance-budgets.md)
