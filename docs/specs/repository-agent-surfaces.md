# Repository agent surfaces

Status: `active`
As of: 2026-08-30

## Scope

This specification owns recognized provider entrypoints, instruction routing, upgrade migration, and repository-rewriter protection. The main [repository knowledge compilation specification](repository-knowledge-compilation.md) owns scanning and publication. [Lifecycle convergence](repository-knowledge-lifecycle-convergence.md) owns ordered repair and final lint.

## Recognized surfaces

Recognized surfaces include AGENTS hierarchy; Claude memory, rules, skills, commands, agents, and settings; Codex rules, hooks, configuration, and custom agents; Agent Skills; and supported third-party entrypoints.

Behavioral instructions, portable skills, and reviewable workflows may be semantic sources. Execution policy, hooks, client and tool configuration, provider subagents, local memory, and unknown `.agents/**` remain inventory-only. Migration may merge only versioned Lervo terminal handlers into project arrays after exact approval. Existing provider semantics are not translated. `.agents/rules/**` is not standard.

## Fixed-size instruction routing

AGENTS contains one fixed-size registry bootstrap rather than one route per source. Task purpose and target paths select current instructions and portable skills through repository knowledge query. Adding, removing, or promoting an independently addressed source does not edit AGENTS.

Schema-1 enumerated routes and the obsolete promoted-pattern block migrate to schema 2. A managed-block-only change is safe upgrade state and preserves all surrounding user bytes. Any coincident user-region rewrite retains exact approval. Immediate replanning after an applied migration is current.

## Rewrite ownership

[Tool-neutral rewrite ownership](repository-knowledge-lifecycle-convergence.md#tool-neutral-rewrite-ownership) protects generated, managed-block, and reviewed-exact bytes from formatter, autofix, transform, and generator adapters. The neutral registry is authoritative; tracked `.prettierignore` projection is deprecated compatibility state.

## Decisions

- [Typed repository agent surface inventory](../decisions/knowledge/repository/0189-typed-repository-agent-surface-inventory.md)
- [Bounded instruction registry and semantic durable-rule intake](../decisions/knowledge/semantics/0304-bounded-instruction-registry-and-semantic-durable-rule-intake.md)
