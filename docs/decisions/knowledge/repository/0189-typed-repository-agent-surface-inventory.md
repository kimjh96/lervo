# ADR-0189: Typed Repository Agent-Surface Inventory

- Status: accepted
- Decision date: 2026-08-23

Partially superseded by [ADR-0193](0193-semantic-repository-and-agent-surface-migration.md): reviewed semantic rules and skills may move with exact approval. Inventory-only configuration and telemetry boundaries remain unchanged.

## Context

Migration must discover more than AGENTS.md, CLAUDE.md, and SKILL.md without treating undocumented conventions or sensitive configuration as semantic documentation. File presence does not prove provider loading, trust, enablement, injection, or use.

## Decision

Under profile v1, the scanner assigns exact, case-sensitive path profiles containing provider, role, scope, documented discovery, migration disposition, and content handling.

Behavior instructions include AGENTS.md, AGENTS.override.md, CLAUDE.md, .claude/CLAUDE.md, and .claude/rules/**/*.md. Agent Skills entries and resources are `skill_contract`; Claude legacy commands are `agent_workflow`; subagents are `agent_definition`; Codex command rules are `execution_policy`; and hooks, clients, and tool surfaces are `agent_configuration`.

.agents/skills/<name>/SKILL.md is a documented Codex project skill and Agent Skills entry. .claude/skills is inventoried as a Claude project skill requiring compatibility review. Dedicated Lervo units still require a validated lervo-skill.json.

.agents/rules/** is not a current Codex, Claude, or Agent Skills standard. Preserve it as `unknown/not_standard/nonstandard_preserve`; never claim it as discovered behavior. Codex execution policy uses .codex/rules/*.rules, while Claude behavioral rules use .claude/rules/**/*.md, with distinct enforcement.

Execution policies, hooks, client and tool configuration, subagents, local memory, and unknown .agents content are `local_inventory_only`. Their bounded hashes may enter local inventory, but their bytes never enter external semantic compiler envelopes or structural publication snapshots or manifests. Plans expose only paths and typed metadata.

Behavior instructions, portable skills, and legacy workflows may be `semantic_source`. This indicates analysis eligibility, not evidence of loading, injection, or use. Provider-specific semantics at risk of loss require review and are never automatically merged into AGENTS.md. Static hierarchy, conditions, fallback, and trust are only documented-discovery possibilities; actual application requires provider-adapter evidence.

All existing paths and bytes remain user-owned. The only automatic write is ADR-0185's managed root AGENTS.md-to-CLAUDE.md import bridge. Inventory creates no event or durable state and exposes no content, absolute path, secret, or provider value.

## Consequences

Fixtures classify official paths and case-sensitive near misses, prove that only semantic sources reach compiler envelopes, expose review and nonstandard diagnostics without mutation, and verify no-op replanning for Lervo and representative provider repositories.

## References

Official OpenAI documentation for Codex AGENTS.md, Agent Skills, command rules, configuration, subagents, and hooks; Anthropic documentation for Claude Code memory and rules, skills and commands, settings, and subagents; and the Agent Skills specification.
