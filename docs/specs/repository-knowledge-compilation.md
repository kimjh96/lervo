# Repository Knowledge Compilation Specification

Status: `active`
As of: 2026-10-05

## Purpose and contract

Lervo compiles bounded repository evidence with or without `docs/`. Portable Markdown and sidecars remain inspectable without a hosted index.

The compilation contract comprises:

- [Sources, policy, and structural publication](repository-knowledge-compilation/structural-publication.md).
- [Semantic compilation, review, and materialization](repository-knowledge-compilation/semantic-review.md): historical; removed by [ADR-0529](../decisions/knowledge/semantics/0529-remove-the-semantic-compilation-pipeline.md).
- [Exchange, failures, and acceptance](repository-knowledge-compilation/validation-and-exchange.md).
- [Document drift and historical documents](repository-knowledge-compilation/document-drift.md).

## Related specifications

[Lifecycle convergence](repository-knowledge-lifecycle-convergence.md) defines merge repair and v2 storage separation. Reviewed sources and semantic records remain canonical; structural records are rebuildable.

[Repository knowledge entrypoints and continuation](repository-knowledge-entrypoints-and-continuation.md) owns canonical instruction bootstrap, provider bridges, continuation-source detection, exact migration, and normalization-record relocation. Initialization invents no root documents. Structural migration never translates existing bytes. Lasting facts belong in routed Markdown, not mutable continuation state.

[Document content normalization](document-content-normalization.md) owns provider profiles, section coverage, split rules, protected material, exact per-source approval, lifecycle records, rollback, and stale-output handling. It uses the capability-free provider boundary after bootstrap, layout, and bridges are current.

[Development-pattern lifecycle](repository-development-pattern-lifecycle.md) is historical under [ADR-0533](../decisions/knowledge/repository/canonicalization/patterns/0533-remove-the-development-pattern-pipeline.md). Instruction capture and the typed [canonicalization assessment](repository-knowledge-lifecycle-convergence.md#canonicalization-assessment) remain active. Background reusable-practice learning is planned separately.

[Background knowledge for every repository change](../decisions/knowledge/repository/canonicalization/0433-own-background-knowledge-for-every-repository-change.md) queues one review job per changed terminal turn, managed run, or Discord repository-work turn. Change sources exclude Git-ignored untracked paths and Lervo projections (`.lervo/generated/`, `.lervo/state/`, `.lervo/data/`, `docs/knowledge/`). A canonical candidate is assigned to the next write-capable terminal or Discord turn, which updates the canonical document and promotes the candidate by exact hash. The legacy version-3 background path never writes user-owned documents itself.

[Autonomous background convergence](background-knowledge-convergence/runtime.md) implements the version-4 successor: continuous baseline discovery, separately authorized review/integration, normalization, and ordered lifecycle verification. The [installed audit](../evidence/quality/background-knowledge-convergence-audit.md) distinguishes current queue settlement from unresolved repository debt. Private installed Codex acceptance verifies this implementation. Production background document writes still require reviewed reader/writer activation and exact per-project delegation.

[Repository knowledge query](repository-knowledge-query.md) owns concept, claim, relation, impact, ranking, relevance-floor, and query evidence semantics. User-authored Markdown and reviewed semantic sidecars remain canonical; structural records and query indexes are rebuildable. A recommendation never proves selection, loading, injection, reference, or use.

[Repository agent surfaces](repository-agent-surfaces.md) defines recognized provider entrypoints, fixed-size instruction routing, upgrade migration, and tool-neutral rewrite protection. Behavioral instructions, portable skills, and reviewable workflows may be semantic sources; provider settings and local memory remain inventory-only.

## References

- [Repository knowledge decision](../decisions/knowledge/repository/0170-evidence-bound-repository-knowledge-compilation.md)
- [OKF exchange decision](../decisions/knowledge/repository/0171-content-addressed-okf-exchange-and-git-reproduction.md)
- [Instruction bridge decision](../decisions/knowledge/repository/0185-profiled-provider-instruction-bridge.md)
- [Agent surface inventory](../decisions/knowledge/repository/0189-typed-repository-agent-surface-inventory.md)
- [Language-aware bounded publication](../decisions/knowledge/repository/0190-language-aware-bounded-repository-publication.md)
- [Repository-scoped decision taxonomy](../decisions/knowledge/repository/0192-repository-scoped-decision-taxonomy.md)
- [Reviewed document content normalization](../decisions/knowledge/repository/0195-reviewed-document-content-normalization.md)
- [Approval-gated cross-provider fuzzy merge](../decisions/knowledge/semantics/0227-approval-gated-cross-provider-fuzzy-merge.md)
- [Fail-closed provider terminal integration](../decisions/execution/providers/0196-fail-closed-provider-terminal-integration.md)
- [Bounded instruction registry and semantic durable-rule intake](../decisions/knowledge/semantics/0304-bounded-instruction-registry-and-semantic-durable-rule-intake.md)
