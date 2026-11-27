# Lervo System Architecture

Status: `active`
As of: 2026-11-27

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

The local project is the execution authority. The Hub coordinates but cannot weaken project policy or replace repository source truth. Direct provider terminals use a narrower native-hook path with separate evidence limits; see [managed execution](system/managed-execution.md).

## Major boundaries

- [Project, storage, workspaces, and capabilities](system/project-and-storage.md)
- [Managed execution and terminal evidence](system/managed-execution.md)
- [Natural-language conversation routing](system/conversation-routing.md)
- [Agent organization and project teams](system/agent-organization.md)
- [Repository knowledge, document ownership, and search](system/knowledge-and-context.md)
- [Hub and node runtimes](system/hub-and-nodes.md)
- [Product surfaces](../specifications/execution/product-surfaces.md): Discord reference acceptance and future first-party host parity over the same application boundary.

## Data ownership and failure

[Data ownership and failure boundaries](data-ownership-and-failure.md) defines canonical ownership, sync defaults, and fail-closed recovery rules.

## Package direction

Contracts and schemas do not depend on provider adapters or applications. Domain packages depend on contracts; storage and provider packages implement ports; applications compose them. Next to the applications, `@lervo/repository-knowledge-runtime` is the shared composition seam for provider strategies: its background knowledge work picks a provider at run time, so it maps that provider to the adapter's no-capability JSON invocation strategy for the knowledge compiler. Only applications and that runtime may have production dependencies on the Claude and Codex provider adapters. `scripts/quality/check-package-boundaries.mjs` enforces this graph.

The schemas package compiles its validators during the build and exposes the same provider-neutral runtime validation facade. [ADR-0503](../decisions/execution/verification/0503-compile-schema-validators-at-build-time.md) defines generated artifact ownership and exact error compatibility; compiler and filesystem work stay outside runtime validation.

The application contract is a contract package, not an application implementation. The work controller may depend on provider-neutral contracts and workforce snapshots, but cannot import CLI, storage adapters, or provider adapters. Product applications depend inward on that boundary.

Discord and future first-party presentation remain adapters outside domain authority. [ADR-0455](../decisions/execution/applications/0455-ratchet-the-platform-adapter-boundary-on-neutral-seams.md) adds a ratchet guard and neutral seams for platform actions, provenance, speaker provisioning, and limits. Activity, operating, observability, and search views are rebuildable projections. Surface actions enter typed application commands; no surface owns a parallel task, chat, workflow, memory, or truth store.

## References

- [Execution and evidence specification](../specifications/execution.md)
- [Repository knowledge specification](../specs/repository-knowledge-compilation.md)
- [Script layout](repository-scripts.md)
- [Decisions](../decisions/)
