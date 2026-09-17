# Lervo product vision

Status: `active`
As of: 2026-09-16

## Purpose

Lervo makes AI-assisted repository work durable, inspectable, and portable without a hosted service. Repositories retain instructions, decisions, source-backed knowledge, execution evidence, verification results, and environment lookup contracts so work can continue on another device or compatible Lervo installation without depending on one conversation.

## Product promise

- Local work completes without a Hub.
- Codex and Claude share a provider-neutral execution and evidence model.
- Bounded source evidence supplies repository knowledge without requiring a documentation layout.
- Human and agent entrypoints stay short; linked documents hold independent concerns.
- Existing user content changes only through exact reviewed approval.
- Optional Hub and node runtimes coordinate repositories and devices without becoming authorities for local source truth.

## Users

Lervo supports developers, researchers, designers, product operators, marketers, and other repository-based roles. Role profiles may differ while sharing one lifecycle for context, capability decisions, evidence, review, and handoff.

One Lervo organization may coordinate several repository-backed project teams. Hired agents remain durable expert identities rather than disposable provider sessions. A policy-bound central leadership agent may coordinate teams without replacing the human owner or weakening repository authority.

Discord is the current installed reference product surface, not the organization runtime or source of truth. Lervo-owned capabilities must be usable and verifiable there before a future first-party surface replaces or coexists with it. Both surfaces use the same headless Lervo application contracts without losing hired-agent identity, reviewed context, conversation coordinates, work state, authority decisions, evidence, source lifecycle, canonical knowledge, or observability.

## Core concepts

- [Managed execution and evidence](vision/execution.md): adapters, direct terminals, evidence states, and revisioned continuation.
- [Repository knowledge and lifecycle](vision/repository.md): discovery, reviewed migration, document routing, skills, and upgrades.
- [Coordination and governed continuation](vision/coordination.md): optional Hub coordination, headless application contracts, and bounded scheduling.
- [Agent organization architecture](../architecture/system/agent-organization.md): project teams, hired experts, central leadership, external identities, and provider-neutral context.
- [Product surfaces](../specifications/execution/product-surfaces.md): Discord acceptance, future first-party parity, ownership, search, knowledge, observability, and compatibility.

## Non-goals for v0

- Requiring a hosted semantic service or external graph database.
- Automatically treating generated summaries as true or verified.
- Rewriting arbitrary user documents without exact review.
- Treating provider configuration or file presence as proof of use.
- Using fuzzy semantic merge before measured failures justify a separate decision.

## Success criteria

1. A new repository can initialize, migrate knowledge, lint, query, and run locally.
2. An existing repository can migrate without losing user bytes or provider-specific semantics.
3. Codex and Claude pass the same adapter contracts.
4. A clean clone or another Lervo installation can reproduce tracked knowledge without a Hub.
5. Generated entrypoints and indexes remain bounded as the repository grows.
6. Every material change has a reviewable plan, verification result, and privacy-bounded event meaning.
7. An initialized repository can converge to an installed Lervo build without hand-composing subsystem migrations or confusing a semantic version with exact runtime bytes.
8. A supported conversation surface can show requested code, perform authorized repository work through the same managed Codex and Claude capabilities as local entrypoints, and return verified results without making the surface an execution authority.
9. Installed comparisons demonstrate whether Lervo grounding, evidence, and verification improve exact task outcomes over direct provider baselines; Lervo never substitutes an unsupported universal quality claim for measured results.
10. One owner can operate central leadership plus the Shiflo, Plen, and Arac repository teams while each hired agent retains isolated durable context and can collaborate through bounded conversations, threads, replies, mentions, assignments, and handoffs.
11. Every Lervo-owned product capability passes its core contract and a real installed Discord journey; a host-neutral conformance scenario proves that a future first-party surface can reuse it without Discord behavior or a second authority.
12. Repository grounding uses the resolved qualified search plan, and knowledge learned through any surface becomes canonical only through exact source-bound review and materialization.
13. Product-host, event, and observation evolution remains additive, migration-safe, rollback-aware, and interpretable across current and predecessor releases.

## Related contracts

- [System architecture](../architecture/system.md)
- [Execution and evidence specification](../specifications/execution.md)
- [v0 roadmap](../roadmap/v0.md)
- [Repository knowledge compilation](../specs/repository-knowledge-compilation.md)
- [Foundational local-first decision](../decisions/foundation/0001-m0-contracts-and-data-defaults.md)
