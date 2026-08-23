# ADR-0193: Semantic Repository and Agent-Surface Migration

- Status: accepted
- Decision date: 2026-08-24

## Context

ADR-0188 moved only selected root documents, while ADR-0189 left provider-specific semantic surfaces as inventory and review findings. Consequently, ordinary documents remained in legacy locations, Claude rules stayed outside Codex discovery, Claude skills stayed outside the shared project-skill location, and provider references became stale. Preserving user bytes was incorrectly equated with preserving every legacy path.

## Decision

`lervo migrate knowledge` performs ordered stages for repository layout, agent-surface normalization, provider bridging, and structural refresh. Repeated runs advance the next current stage. Completion requires a subsequent plan with no changed operation.

Repository routes in `.lervo/knowledge/document-layout.yaml` provide the shared semantic vocabulary for decisions, ordinary documents, and instructions. Root and subsystem entrypoints—including root README, HANDOFF, CONTRIBUTING, SECURITY, CHANGELOG, and package README files—stay in place. A legacy `docs/README.md` is not exempt by basename: route substantive policy while generated knowledge navigation becomes the documentation entrypoint. Generated knowledge and established product, architecture, decision, evidence, research, roadmap, specification, and instruction trees remain stable.

Classify other Markdown through explicit `lervo.document.route` metadata or one strongest filename-and-H1 match. Explicit metadata may set a safe `lervo.document.filename` when a generic basename would remain misleading. Unknown or tied matches block. Approved documents move to `docs/<route>/`; links and exact repository-path references are rebased in the same durable transaction.

Claude rules under `.claude/rules` are semantic sources, not permanent canonical storage. Parse current `paths` and legacy `globs` metadata, including comma-separated brace expressions; move each rule to `docs/instructions/<route>/`; and write a bounded managed routing block in root AGENTS. Move skill packages from `.claude/skills/<name>` to `.agents/skills/<name>`. AGENTS routes tasks to canonical `SKILL.md`, giving Codex its documented project location and Claude access through the AGENTS import bridge. Agent Skills remain portable; do not invent a Lervo managed-run manifest from prose.

Root AGENTS is provider-neutral. Root CLAUDE preserves user-authored bytes and receives or refreshes only the approved `provider_entry` managed block importing `@AGENTS.md`. Adding that block to an unmanaged CLAUDE file requires exact approval. Updates to obsolete `.claude/rules` or `.claude/skills` references and to the AGENTS routing block are content-bound. Reference-only repairs have independent item IDs and hashes and still require approval.

Provider enforcement and client configuration do not become shared policy. Claude settings, local settings, MCP configuration, output styles, subagents, agent memory, plugins, worktree inclusion, and hooks—and Codex configuration, command rules, hooks, and subagents—retain typed provider profiles. Local, execution-policy, tool, hook, and unknown configuration bytes remain local inventory only. Report `.claude/hooks.json` as nonstandard because Claude hooks belong in settings. Inventory does not prove loading, trust, enablement, injection, or use.

Each user move or update binds before and after bytes, destination when applicable, related reference changes, and lineage to an exact approval hash. Refresh structural publications, source units, concepts, and any instruction-bridge record against the same virtual post-change scan. Destination collisions remain deterministic blockers; exclude colliding candidates from execution and virtual projection instead of failing midway.

Apply uses one durable journal. Any lint or event failure rolls back all user and generated files. Events contain only bounded counts, hashes, and path digests.

## Consequences

Migration cannot report completion while classifiable documents or Claude-only semantic rules remain at legacy paths. Codex and Claude share one instruction source without conflating provider settings. New repositories follow the same staged lifecycle when an entrypoint or bridge is needed. Ambiguous documents require route evidence rather than a catch-all.

Contract tests cover repository-wide and nested moves, `docs/README.md`, unclassified and colliding blockers, explicit routes and filenames, Claude rules and skills, brace-aware parsing, reference-only approvals, rollback, bridge preservation, lint, and idempotent reruns. The Shiflo pilot verifies the full sequence, no remaining legacy provider paths, valid knowledge, and a zero-change replan.

## Superseded clauses

This decision extends ADR-0188 beyond recognized root roles. It supersedes ADR-0189 only where that decision kept all provider-specific semantic paths and bytes in place or prohibited normalization of reviewed rules and skills. ADR-0189's telemetry, privacy, inventory-only configuration, and no-load-claim boundaries remain effective.

## References

- OpenAI Codex documentation for AGENTS.md, project skills, project configuration, rules, hooks, and subagents.
- Anthropic Claude Code documentation for memory and rules, settings, skills, subagents, plugins, and configuration debugging.
- Agent Skills specification.
