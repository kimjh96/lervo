# Provider Adapter Specification

Status: `active`
As of: 2026-08-30

Defines provider-neutral adapter telemetry, direct terminal integration, publication evaluation, and result projection. The parent [execution and evidence specification](../execution.md) defines the managed-run lifecycle and assurance levels.

- [Adapter telemetry](provider-adapters/telemetry.md): native events, usage, result constraints, process observation, and selection boundaries.
- [Direct terminal integration](provider-adapters/terminal-integration.md): handlers, reconciliation, migration, and activation readiness.
- [Publication evaluation and projection](provider-adapters/publication.md): publication evaluation, evidence tokens, and role and eligibility contracts.

Process observation follows [ADR-0372](../../decisions/execution/orchestration/0372-observe-managed-provider-process-state-through-adapters.md).
