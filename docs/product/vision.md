# Lervo product vision

Status: `active`  
As of: 2026-08-23

## Purpose

Lervo makes AI-assisted repository work durable, inspectable, and portable without requiring a hosted service. Repositories retain the instructions, decisions, source-backed knowledge, execution evidence, verification results, and environment lookup contracts needed to continue work on another device or compatible Lervo installation without depending on one conversation.

## Product promise

- Local work completes without a Hub.
- Codex and Claude share a provider-neutral execution and evidence model.
- Bounded source evidence, rather than a required documentation layout, supplies repository knowledge.
- Human and agent entrypoints stay short; independent concerns use linked documents.
- Existing user content changes only through exact reviewed approval.
- Optional Hub and node runtimes coordinate repositories and devices without becoming authorities for local source truth.

## Users

Lervo supports developers and other repository-based roles, including researchers, designers, product operators, and marketers. Role profiles can differ while sharing one lifecycle for context, capability decisions, evidence, review, and handoff.

## Core concepts

### Managed execution

Lervo starts an agent through a provider adapter, supplies a bounded context envelope, records observable lifecycle evidence, gates writes and external effects, and verifies repository state. Work started directly in an external provider terminal is `unmanaged` unless an adapter proves the same contract.

### Repository knowledge

Explicit privacy and size policies govern discovery of code, configuration, schemas, tests, documents, agent instructions, skills, verification results, execution events, revision identity, logs, and unsupported-file metadata. Structural extraction creates navigation and source identity. Semantic candidates remain unreviewed until reconciliation and human review.

Migration creates an explicit repository structure and documentation system. Ordinary documents use repository-scoped semantic routes and reviewed audience-specific formats; behavioral instructions use provider-neutral canonical pages routed from AGENTS; portable skills use `.agents/skills` with resource-bound lifecycle records; provider configuration remains provider-specific. Moving or rewriting user bytes requires exact content-bound approval.

### Evidence language

`selected`, `loaded`, `injected`, `referenced`, and `used` are distinct states. Lervo promotes none without matching telemetry.

### Optional coordination

A Hub can synchronize allowed events, route signed commands, and show cross-project status. A project node revalidates identity, authorization, freshness, repository state, and local policy before execution.

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

## Related contracts

- [System architecture](../architecture/system.md)
- [Execution and evidence specification](../specifications/execution.md)
- [v0 roadmap](../roadmap/v0.md)
- [Repository knowledge compilation](../specs/repository-knowledge-compilation.md)
- [Foundational local-first decision](../decisions/foundation/0001-m0-contracts-and-data-defaults.md)
