# ADR-0189: Typed Repository Agent-Surface Inventory

- Status: accepted
- Decision date: 2026-08-23

Partially superseded by [ADR-0193](0193-semantic-repository-and-agent-surface-migration.md): reviewed semantic rules and skills may now move under exact approval. Inventory-only configuration and telemetry boundaries remain unchanged.

## Context

Migration must discover more than AGENTS.md, CLAUDE.md, and SKILL.md without treating undocumented conventions or sensitive configuration as semantic documentation. File presence proves no provider load, trust, enablement, injection, or use.

## Decision

The scanner assigns exact case-sensitive path profiles with provider, role, scope, documented discovery, migration disposition, and content handling under profile v1.

Behavior instructions include AGENTS.md, AGENTS.override.md, CLAUDE.md, .claude/CLAUDE.md, and .claude/rules/**/*.md. Agent Skills entries/resources are skill_contract; Claude legacy commands agent_workflow; subagents agent_definition; Codex command rules execution_policy; hooks/client/tool surfaces agent_configuration.

.agents/skills/<name>/SKILL.md is documented Codex project skill and Agent Skills entry. .claude/skills is inventoried as Claude project skill with compatibility review. Dedicated Lervo units still require validated lervo-skill.json.

.agents/rules/** is not a current Codex, Claude, or Agent Skills standard. It is preserved as unknown/not_standard/nonstandard_preserve and never claimed as discovered behavior. Codex execution policy is .codex/rules/*.rules; Claude behavioral rules are .claude/rules/**/*.md, with distinct enforcement.

Execution policies, hooks, client/tool config, subagents, local memory, and unknown .agents are local_inventory_only. Their bounded hashes may be inventoried, but bytes never enter external semantic compiler envelopes or structural publication snapshots/manifests. Plans expose path and typed metadata only.

Behavior instructions, portable skills, and legacy workflows may be semantic_source; this is analysis eligibility, not loaded/injected/used evidence. Provider-specific semantics at risk of loss are review-required and never auto-merged into AGENTS.md. Static hierarchy/conditions/fallback/trust remain documented-discovery possibilities; actual application requires provider adapter evidence.

All existing bytes/paths remain user-owned. The only automatic write is ADR-0185's root AGENTS.md-to-CLAUDE.md managed import bridge. Inventory adds no event or durable state and exposes no content, absolute path, secret, or provider values.

## Consequences

Fixtures classify official paths with case-sensitive near misses, prove only semantic sources reach compiler envelopes, expose review/nonstandard diagnostics without mutation, and verify no-op replanning on Lervo and representative provider repositories.

## References

Official OpenAI Codex AGENTS.md, Agent Skills, command rules, configuration, subagents, and hooks documentation; Anthropic Claude Code memory/rules, skills/commands, settings, and subagents documentation; and the Agent Skills specification.
