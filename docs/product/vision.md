# Lervo product vision

Status: `active`
As of: 2026-10-04

## Purpose

Lervo makes AI-assisted repository work durable, inspectable, and portable without a hosted service. Repositories retain instructions, decisions, source-backed knowledge, execution evidence, verification results, and environment lookup contracts. Work can continue on another device or compatible Lervo installation without depending on one conversation.

## Product promise

- Local work completes without a Hub.
- Codex and Claude share a provider-neutral execution and evidence model.
- Bounded source evidence supplies repository knowledge without requiring a documentation layout.
- Human and agent entrypoints stay short; linked documents hold independent concerns.
- Existing user content changes only through exact reviewed approval.
- Optional Hub and node runtimes coordinate repositories and devices without becoming authorities for local source truth.

## Vision details

- [Users, organization, and product surfaces](vision/users.md)
- [Success criteria](vision/success-criteria.md)

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

## Related contracts

- [System architecture](../architecture/system.md)
- [Execution and evidence specification](../specifications/execution.md)
- [v0 roadmap](../roadmap/v0.md)
- [Repository knowledge compilation](../specs/repository-knowledge-compilation.md)
- [Foundational local-first decision](../decisions/foundation/0001-m0-contracts-and-data-defaults.md)
