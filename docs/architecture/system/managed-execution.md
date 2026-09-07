# Managed execution and terminal evidence

- [Managed admission and activation](managed-execution/admission-and-activation.md)
- [Coverage and publication](managed-execution/coverage-and-publication.md)
- [Direct provider terminals](managed-execution/direct-provider-terminals.md)
- [Headless application boundary](managed-execution/headless-application-boundary.md)

## Specifications

The headless application boundary rebuilds [operating-attention](../../specifications/execution/operating-attention.md) and [operating-liveness](../../specifications/execution/operating-liveness.md) reports alongside assignment, attempt, resource, and next-action reports.

See [resource and performance budgets](../../specifications/execution/resource-and-performance-budgets.md), [bounded unattended scheduling](../../specifications/execution/unattended-scheduling.md), [interactions](../../specifications/execution/assignment-interactions.md), [routines](../../specifications/execution/assignment-routines.md), and [connectors](../../specifications/execution/assignment-connectors.md).

## Decisions

- [Context preparation](../../decisions/execution/orchestration/0006-deterministic-context-preparation.md)
- [Context delivery](../../decisions/execution/providers/0007-provider-neutral-context-delivery.md)
- [Managed context gate](../../decisions/execution/orchestration/0008-managed-context-gate-orchestration.md)
- [Codex adapter](../../decisions/execution/providers/0009-codex-app-server-managed-adapter.md)
- [Claude adapter](../../decisions/execution/providers/0010-claude-agent-sdk-managed-adapter.md)
- [Run lifecycle](../../decisions/execution/providers/0011-managed-provider-run-lifecycle.md)
- [Terminal integration](../../decisions/execution/providers/0196-fail-closed-provider-terminal-integration.md)
- [Unmanaged observation](../../decisions/execution/providers/0197-unmanaged-terminal-context-observation.md)
- [Managed grounding](../../decisions/execution/providers/0198-managed-context-grounding-and-coverage.md)
- [Natural-language finalization](../../decisions/execution/providers/0200-natural-language-terminal-turn-finalization.md)
- [Provider-confirmed capability activation](../../decisions/execution/providers/0211-provider-confirmed-capability-activation.md)
- [Isolated agent workspaces](../../decisions/execution/orchestration/0222-isolated-agent-workspace-lifecycle.md)
- [Headless governed loops](../../decisions/execution/orchestration/governed-work/0336-adopt-headless-governed-loop-and-assignment-graph.md)
- [Bounded unattended scheduling](../../decisions/execution/orchestration/governed-work/0379-install-bounded-unattended-assignment-scheduling.md)
