# ADR-0193: Semantic Repository and Agent-Surface Migration

- Status: accepted
- Decision date: 2026-08-24

## Context

ADR-0188 moved only selected root documents, while ADR-0189 retained provider-specific semantic surfaces as inventory and review findings. Ordinary documents remained in legacy locations, Claude rules and skills remained outside shared Codex-visible locations, and provider references became stale. Preserving user bytes had been conflated with preserving every legacy path.

## Decision

`lervo migrate knowledge` performs ordered repository-layout, agent-surface normalization, provider-bridge, and structural-refresh stages. Each run advances the next current stage; completion requires a subsequent zero-change plan.

Repository routes in `.lervo/knowledge/document-layout.yaml` define shared semantics for decisions, ordinary documents, and instructions. Root and subsystem entrypoints remain in place, including the root README, HANDOFF, CONTRIBUTING, SECURITY, CHANGELOG, and package README files. A legacy `docs/README.md` is not exempt by basename: route substantive policy and make generated knowledge navigation the documentation entrypoint. Established product, architecture, decision, evidence, research, roadmap, specification, instruction, and generated-knowledge trees remain stable.

Classify other Markdown through explicit `lervo.document.route` metadata or one strongest filename-and-H1 match. Explicit metadata may specify a safe `lervo.document.filename` when a generic basename would mislead. Unknown or tied matches block. Move approved documents to `docs/<route>/`, rebasing links and exact repository-path references in the same durable transaction.

Claude rules under `.claude/rules` are semantic sources, not permanent canonical storage. Parse current `paths` and legacy `globs` metadata, including comma-separated brace expressions; move rules to `docs/instructions/<route>/`; and write a bounded managed routing block in root AGENTS. Move `.claude/skills/<name>` packages to `.agents/skills/<name>`. AGENTS routes tasks to canonical `SKILL.md`, providing Codex's documented project location and Claude access through the AGENTS import bridge. Agent Skills remain portable; do not convert prose into a Lervo managed-run manifest.

Root AGENTS is provider-neutral. Root CLAUDE preserves user-authored bytes and receives or refreshes only the approved `provider_entry` managed block importing `@AGENTS.md`. Adding the block to an unmanaged CLAUDE file requires exact approval. Changes to obsolete exact `.claude/rules/<file>` or `.claude/skills/<file>` references and to the AGENTS routing block are content-bound. Reference-only repairs have independent item IDs and hashes and require approval.

Provider enforcement and client configuration do not become shared policy. Claude settings, local settings, MCP configuration, output styles, subagents, memory, plugins, worktree inclusion, and hooks—and Codex configuration, command rules, hooks, and subagents—retain typed provider profiles. Local, execution-policy, tool, hook, and unknown configuration bytes remain inventory only. Report `.claude/hooks.json` as nonstandard because Claude hooks belong in settings. Inventory does not prove loading, trust, enablement, injection, or use. ADR-0196 permits one narrow exception: exact-approved insertion of versioned Lervo terminal handlers without translating or replacing provider semantics.

Every user move or update binds before and after bytes, any destination, related reference changes, and lineage to an exact approval hash. Refresh structural publications, source units, concepts, and instruction-bridge records against the same virtual post-change scan. Destination collisions are deterministic blockers; exclude them from execution and virtual projection instead of failing midway.

Apply uses one durable journal. Any lint or event failure rolls back all user and generated files. Events contain only bounded counts, hashes, and path digests.

## Consequences

Migration cannot complete while classifiable documents or Claude-only semantic rules remain at legacy paths. Codex and Claude share one instruction source without conflating provider settings. New repositories follow the same lifecycle when an entrypoint or bridge is needed. Ambiguous documents require route evidence rather than a catch-all.

Contract tests cover repository-wide and nested moves, `docs/README.md`, blockers, explicit routes and filenames, Claude rules and skills, brace-aware parsing, reference-only approvals, rollback, bridge preservation, lint, and idempotent reruns. The Shiflo pilot verifies the full sequence, no remaining legacy provider paths, valid knowledge, and a zero-change replan.

## Superseded clauses

This decision extends ADR-0188 beyond recognized root roles. It supersedes ADR-0189 only where that decision retained all provider-specific semantic paths and bytes or prohibited normalization of reviewed rules and skills. ADR-0189's telemetry, privacy, inventory-only configuration, and no-load-claim boundaries remain effective.

ADR-0199 supersedes the root HANDOFF entrypoint exception. Active continuation now uses structured workstream state; durable historical documents remain semantically routed.

## References

- OpenAI Codex documentation for AGENTS.md, project skills, project configuration, rules, hooks, and subagents.
- Anthropic Claude Code documentation for memory and rules, settings, skills, subagents, plugins, and configuration debugging.
- Agent Skills specification.
