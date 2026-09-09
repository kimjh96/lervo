# Repository agent surfaces

Status: `active`
As of: 2026-08-30

## Scope

This specification owns recognized provider entrypoints, instruction routing, upgrade migration, and repository-rewriter protection. [Repository knowledge compilation](repository-knowledge-compilation.md) owns scanning and publication. [Lifecycle convergence](repository-knowledge-lifecycle-convergence.md) owns ordered repair and final lint.

## Contracts

- [Recognized surfaces](repository-agent-surfaces/recognized-surfaces.md): classification, resource handling, and provider migration boundaries.
- [Fixed-size instruction routing](repository-agent-surfaces/instruction-routing.md): registry bootstrap and schema upgrades.
- [Rewrite ownership](repository-agent-surfaces/rewrite-ownership.md): protection of generated, managed, and reviewed bytes under [tool-neutral rewrite ownership](repository-knowledge-lifecycle-convergence.md#tool-neutral-rewrite-ownership).

## Decisions

- [Typed repository agent surface inventory](../decisions/knowledge/repository/0189-typed-repository-agent-surface-inventory.md)
- [Bounded instruction registry and semantic durable-rule intake](../decisions/knowledge/semantics/0304-bounded-instruction-registry-and-semantic-durable-rule-intake.md)
