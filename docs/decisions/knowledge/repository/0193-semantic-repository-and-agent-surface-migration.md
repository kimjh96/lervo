# ADR-0193: Semantic Repository and Agent-Surface Migration

- Status: accepted
- Decision date: 2026-08-24

## Context

ADR-0188 moved only a few recognized root documents, while ADR-0189 treated provider-specific semantic surfaces as inventory and review findings. That left ordinary documents in legacy `docs/` and nested directories, Claude rules outside Codex discovery, Claude skills outside the shared project skill location, and stale provider references after an otherwise successful migration. Preservation of user bytes was incorrectly treated as preservation of every legacy path.

## Decision

`lervo migrate knowledge` treats repository layout, agent-surface normalization, provider bridging, and structural refresh as ordered migration stages. Re-running the command advances the next current stage; completion means a subsequent plan contains no changed operation.

The repository-scoped routes in `.lervo/knowledge/document-layout.yaml` are the shared semantic vocabulary for decisions, ordinary documents, and instructions. Root and subsystem entrypoints such as the root README, HANDOFF, CONTRIBUTING, SECURITY, CHANGELOG, and package README files remain in place. A legacy `docs/README.md` is not exempt merely because of its basename: substantive policy must be routed, while generated knowledge navigation provides the documentation entrypoint. Lervo-generated knowledge and established product, architecture, decision, evidence, research, roadmap, specification, and instruction trees are also stable. Other discovered Markdown is classified from explicit `lervo.document.route` metadata or one strongest filename-and-H1 route match. Explicit metadata may also supply a safe `lervo.document.filename` when a generic legacy basename would remain misleading. Unknown and tied matches block instead of remaining silently unmigrated. Approved documents move to `docs/<route>/`; links and exact repository path references are rebased in the same durable transaction.

Claude behavioral rules under `.claude/rules` are semantic sources, not permanent canonical storage. Migration parses current `paths` metadata and legacy `globs` metadata, including comma-separated brace expressions, moves each rule to `docs/instructions/<route>/`, and writes a bounded managed routing block in root AGENTS. Claude skill packages move from `.claude/skills/<name>` to `.agents/skills/<name>`. AGENTS routes matching tasks to canonical `SKILL.md`; this gives Codex its documented project location and Claude access through the AGENTS import bridge. The Agent Skills package remains portable; a Lervo managed-run manifest is a distinct capability contract and is not invented from prose.

Root AGENTS is the provider-neutral entrypoint. Root CLAUDE preserves user-authored bytes and receives or refreshes only the approved `provider_entry` managed block importing `@AGENTS.md`. Existing unmanaged CLAUDE files may receive that bounded block after exact approval. Obsolete `.claude/rules` and `.claude/skills` path references, and the AGENTS route block itself, are content-bound user updates. Reference-only repair plans therefore have their own item IDs and hashes; they do not bypass approval merely because no file moves.

Provider enforcement and client configuration do not become shared semantic policy. Claude settings, local settings, MCP configuration, output styles, subagents, agent memory, plugins, worktree inclusion, and hooks; and Codex config, command rules, hooks, and subagents retain typed provider profiles. Local, execution-policy, tool, hook, and unknown configuration bytes remain local inventory only. A nonstandard `.claude/hooks.json` is reported as nonstandard because Claude hooks belong in settings. Inventory never proves loading, trust, enablement, injection, or use.

Every user move or update binds before bytes, after bytes, destination where applicable, related reference changes, and lineage to an exact approval hash. Structural publications, source units, concepts, and an existing instruction-bridge record refresh against the same virtual post-change scan. Candidates that collide at one destination remain represented by blockers but are excluded from execution and virtual projection, so planning returns a deterministic blocked result rather than throwing midway through projection. Apply uses one durable journal; lint or event failure rolls every user and generated file back. Events retain only bounded counts, hashes, and path digests.

## Consequences

Migration no longer reports completion while classifiable legacy documents or Claude-only semantic rules remain at old paths. Codex and Claude share one instruction source without pretending that provider-specific settings are equivalent. New repositories receive the same staged lifecycle once an entrypoint or bridge is needed. Repositories with ambiguous documents must add route evidence rather than rely on a catch-all folder.

Contract tests cover repository-wide document moves, nested documents, documentation-root README handling, unclassified and colliding-destination blockers, explicit routes and filenames, Claude rule and skill moves, brace-aware path parsing, reference-only approvals, rollback, provider bridge preservation, lint, and idempotent CLI reruns. The Shiflo pilot applies the complete sequence and verifies no remaining legacy provider paths, valid knowledge, and a zero-change replan.

## Superseded clauses

This decision extends ADR-0188 beyond recognized root roles. It supersedes ADR-0189's clauses that all provider-specific semantic bytes and paths remain in place and that migration never normalizes reviewed rules or skills. ADR-0189's telemetry, privacy, inventory-only configuration, and no-load-claim boundaries remain in force.

## References

- OpenAI Codex AGENTS.md, project skills, project configuration, rules, hooks, and subagent documentation.
- Anthropic Claude Code memory/rules, settings, skills, subagents, plugins, and configuration-debugging documentation.
- Agent Skills specification.
