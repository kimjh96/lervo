# Lervo Execution and Evidence Specification

Status: `active`
As of: 2026-09-01

Defines provider-neutral managed execution and evidence contracts. ADRs retain rationale.

## Contract topics

- [Managed lifecycle and context evidence](execution/lifecycle-and-context.md): lifecycle, direct hooks, continuation, E0–E4, roles, eligibility, and coverage.
- [Authority and repository changes](execution/authority-and-repository.md): capabilities, approvals, snapshots, assignments, verification, knowledge, and publication.
- [Operations and recovery](execution/operations-and-recovery.md): events, privacy, durable apply, remote execution, failures, and required verification.

## Related specifications

- [Typed semantic grounding](execution/semantic-grounding.md) precedes selection and effects.
- [Managed linked evidence](execution/managed-linked-evidence-canary.md) defines the default-off exact canary, E1–E4 separation, bounded records, historical activation evidence, later production retirement, rejected prompt-only attempt, typed boundary, claim eligibility, paired control, and retirement. It owns canary record bounds and privacy exclusions.
- [Capability packages](execution/capabilities.md) cover skills, MCP servers, plugins, and bundles.
- [Provider adapters](execution/provider-adapters.md) defines provider-specific configuration, terminal integration, usage normalization, publication evaluation, and result projection. Codex and Claude share provider-neutral contracts without invented telemetry.
- Repository assignments: [interactions](execution/assignment-interactions.md), [routines](execution/assignment-routines.md), and [connectors](execution/assignment-connectors.md).
- [Governed loops](../roadmap/governed-loop-assignment-graph.md) defines bounded continuation.
- [Repository knowledge compilation](../specs/repository-knowledge-compilation.md) owns scanner, taxonomy, normalization bounds, caching, retry, publication, durable apply, lifecycle, skill, entrypoint, agent-surface, and recovery details.
- [State lifecycle](execution/state-lifecycle.md) defines durable local data and rebuildable projections.
- [Events and privacy](execution/events-and-privacy.md) owns event contracts, reader compatibility, writer activation, and failure codes.
- [Stage observation and performance](execution/stage-observation-and-performance.md) defines timing, environment, projection, and performance gates.
- [Operating liveness](execution/operating-liveness.md) defines the installed read-only separation of root-agent heartbeat and managed-provider point-in-time process evidence.
- [Bounded unattended scheduling](execution/unattended-scheduling.md) defines periodic governed selection, exact-revision claim, finite execution limits, kill-switch behavior, and uncertain-effect recovery.
- [Adverse-condition safety](execution/adverse-condition-safety.md) defines the common effect inventory, exact completion/rollback/recovery projection, cancellation and backpressure bounds, telemetry field registry, threat model, capacity and retention profiles, and compatibility rehearsals.
- [Hub and Node coordination](coordination/hub-and-node.md) defines remote coordination.

## References

- [System architecture](../architecture/system.md)
- [v0 roadmap](../roadmap/v0.md)
- [Managed run lifecycle ADR](../decisions/execution/providers/0011-managed-provider-run-lifecycle.md)
- [Signed approval ADR](../decisions/execution/verification/0044-signed-approval-managed-write-permit.md)
- [Repository knowledge ADR](../decisions/knowledge/repository/0170-evidence-bound-repository-knowledge-compilation.md)
- [Bounded publication ADR](../decisions/knowledge/repository/0190-language-aware-bounded-repository-publication.md)
- [Resource and performance budgets](execution/resource-and-performance-budgets.md)
