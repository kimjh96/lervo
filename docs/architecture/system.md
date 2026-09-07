# Lervo System Architecture

Status: `active`
As of: 2026-08-26

## System shape

```text
user or platform
  -> Lervo CLI / conversation boundary
  -> policy and capability evaluation
  -> context selection and exact delivery receipt
  -> managed provider adapter (Codex or Claude)
  -> repository change and verification
  -> local event store + CAS
  -> optional outbox -> Hub -> other authorized nodes
```

The local project is the execution authority. The Hub coordinates but cannot weaken project policy or replace repository source truth.

Direct provider terminals use a narrower native-hook path with separate evidence limits; see [managed execution](system/managed-execution.md).

## Major boundaries

- [Project, storage, workspaces, and capabilities](system/project-and-storage.md)
- [Managed execution and terminal evidence](system/managed-execution.md)
- [Natural-language conversation routing](system/conversation-routing.md)
- [Repository knowledge, document ownership, and search](system/knowledge-and-context.md)
- [Hub and node runtimes](system/hub-and-nodes.md)

## Data ownership and failure

[Data ownership and failure boundaries](data-ownership-and-failure.md) defines canonical ownership, sync defaults, and fail-closed recovery rules.

## Package direction

Contracts and schemas do not depend on provider adapters or applications. Domain packages depend on contracts; storage and provider packages implement ports; applications compose them. `scripts/quality/check-package-boundaries.mjs` enforces this graph.

The application contract is a contract package, not an application implementation. The work controller may depend on provider-neutral contracts and workforce snapshots; it cannot import CLI, storage adapters, or provider adapters. Product applications depend inward on that boundary.

## References

- [Execution and evidence specification](../specifications/execution.md)
- [Repository knowledge specification](../specs/repository-knowledge-compilation.md)
- [Script layout](repository-scripts.md)
- [Decisions](../decisions/)
