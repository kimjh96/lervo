# Lervo Product Vision

Status: `active`
As of: 2026-08-23

## Purpose

Lervo makes AI-assisted repository work durable, inspectable, and portable without making a hosted service mandatory.

A repository should retain the context needed to continue work: current instructions, decisions, source-backed knowledge, execution evidence, verification results, and environment lookup contracts. An agent on another device—or another compatible Lervo installation—should be able to discover that context from repository sources instead of depending on one conversation.

## Product promise

- Local work completes without a Hub.
- Codex and Claude use one provider-neutral execution and evidence model.
- Repository knowledge comes from bounded source evidence, not a required documentation layout.
- Human and agent entrypoints stay short; independent concerns live in separate linked documents.
- Existing user content is preserved unless an exact, reviewed change is approved.
- Optional Hub and node runtimes coordinate repositories and devices without becoming the authority for local source truth.

## Users

Lervo serves developers and other repository-based roles such as researchers, designers, product operators, and marketers. Role profiles may differ, but they share the same lifecycle for context, capability decisions, evidence, review, and handoff.

## Core concepts

### Managed execution

Lervo starts an agent through a provider adapter, supplies a bounded context envelope, records observable lifecycle evidence, gates writes and external effects, and verifies the resulting repository state. Work started directly in an external provider terminal is `unmanaged` unless an adapter can prove the same contract.

### Repository knowledge

Code, configuration, schemas, tests, documents, agent instructions, skills, verification results, execution events, revision identity, logs, and unsupported file metadata are discovered under explicit privacy and size policies. Structural extraction produces navigation and source identity; semantic candidates remain unreviewed until reconciliation and human review.

Migration turns that inventory into an explicit repository structure: ordinary documents use repository-scoped semantic routes, behavioral instructions use provider-neutral canonical pages routed from AGENTS, portable skills use `.agents/skills`, and provider configuration remains provider-specific. Any user-byte move or update requires an exact content-bound approval.

### Evidence language

`selected`, `loaded`, `injected`, `referenced`, and `used` are different states. Lervo never promotes one to another without matching telemetry.

### Optional coordination

A Hub can synchronize allowed events, route signed commands, and present cross-project status. A project node revalidates identity, authorization, freshness, repository state, and local policy before execution.

## Non-goals for v0

- Requiring a hosted semantic service or external graph database.
- Automatically declaring generated summaries true or verified.
- Rewriting arbitrary user documents without exact review.
- Treating provider configuration or file presence as proof that an agent used it.
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
