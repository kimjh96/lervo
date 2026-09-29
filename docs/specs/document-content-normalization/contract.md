# Normalization contract

After canonical bootstrap, layout, and bridges are current, `migrate knowledge --provider codex|claude` uses the same boundary to return bounded Markdown candidates. Entrypoint adoption, bridge disposition, and prose normalization remain independent.

## V1 scope

- Covers ordinary `.md` files outside generated navigation and `.changes/`.
- Distinguishes README, agent instruction, bridge, portable skill or reference, decision, product, architecture, specification, roadmap, instruction, pull-request template, and general document profiles.
- Excludes release intents and the replace-in-place current release note from provider normalization; both retain release ownership.
- Uses `publication.language`; v1 accepts `en`.

## Output structure

Every input retains an output at its original path. Ordinary splits use a sibling directory named for the source stem. The root README must not create a root-level `README/` tree; durable detail belongs in the semantic documentation hierarchy. Historical continuation documents may use the bounded handoff profile based on content, while the selected active source has already entered the workstream stage.

Normalized documents have one H1. The exception is `.github/PULL_REQUEST_TEMPLATE.md`: it never splits, contains no H1, and starts at H2 because GitHub renders the title. All outputs obey byte and line limits. Bridges remain below 2 KiB and 40 lines.

## Preservation and validation

Coverage maps every source section to one or more declared outputs through complete, document-local integer indexes resolved to content-bound versions. Validation preserves:

- Path-scope frontmatter.
- Lifecycle metadata such as `Status:` and `As of:`.
- Managed blocks and provider imports.
- Agent Skill `name`.
- Fenced examples and links in skills and instructions.
- Portable inline coordinates.

Outputs end with exactly one newline. Newly introduced trailing spaces, tabs, or blank lines are rejected. Exact source lines may retain required trailing whitespace only through protected material.

Root README routes agents to `AGENTS.md`; wiki links become portable Markdown. Skill descriptions may be localized without changing identity. Canonical instruction frontmatter remains exact. Further condensation requires exact human review.

Skill resource hashes bind lifecycle and approval; scripts and assets are not rewritten. When reviewed skill prose changes a content-bound project package, the same transaction deterministically refreshes its Lervo manifest content hashes. Manifests are package metadata, not lifecycle resources: normalization records bind the resulting prose, scripts, references, and assets without becoming immediately stale from the required metadata update.

## Review and apply

Candidates and shard responses remain ignored local state. Cache identity binds the envelope and compiler build. Plans bind exact candidate bytes and require per-source approval.

Normalization debt is agent work, not a user or reviewer queue (amended 2026-09-26). Documents become pending whenever they are added or edited after normalization. Every repository-changing agent turn therefore advances one bounded batch, whatever its task: a terminal turn receives it as an agent-owned attention item, and a Discord repository-work turn receives it in its instructions. The turn runs `lervo knowledge normalize --scope all-pending --max-provider-calls 8`, compares each candidate with its source, and applies the accepted ones with their exact approval hashes. A candidate that loses meaning stays unapproved and is reported.

A sandboxed provider turn cannot start a nested provider process. Codex repository-work turns run under `codex exec`, with no network and a restricted home, so candidate generation inside them stops at the Codex model-input capability probe (amended 2026-09-26). The Node therefore generates candidates in the background, outside the provider sandbox, with the conversation's configured provider. A Discord turn then receives a stored candidate to review with `--candidate <id> --json` and to apply with `--candidate <id> --apply <planId>` and its exact approvals, and it never runs `--provider`. A turn that starts before any candidate exists gets no normalization assignment; a later turn receives the candidate. Applying always requires `--candidate`, including after a terminal `--provider` run.

Apply never reruns the provider. It writes candidates and sharded lifecycle records through the journal, then emits `knowledge.materialization.applied` with `operation=normalize_documents`.

## Planned autonomous continuation

[ADR-0434](../../decisions/knowledge/repository/canonicalization/0434-converge-background-canonicalization-normalization-and-knowledge.md) implements independent agent review under an exact repository delegation, followed by authorized background apply and lifecycle verification. Generation does not grant review or write authority. The turn-owned review procedure above remains current on projects without reviewed version-4 activation and delegation. See the [runtime contract](../background-knowledge-convergence/runtime.md) for autonomous review/apply and the [authority and completion contract](../background-knowledge-convergence/authority-and-completion.md) for its design boundary.
