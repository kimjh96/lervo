# Normalization contract

After canonical bootstrap, layout, and bridges are current, `migrate knowledge --provider codex|claude` uses the same boundary to return bounded Markdown candidates. Entrypoint adoption, bridge disposition, and prose normalization remain independent.

## V1 scope

- Covers ordinary `.md` files outside generated navigation and `.changes/`.
- Distinguishes README, agent instruction, bridge, portable skill or reference, decision, product, architecture, specification, roadmap, instruction, pull-request template, and general document profiles.
- Excludes release intents and the replace-in-place current release note from provider normalization; both retain release ownership.
- Excludes tool-generated documents ([ADR-0473](../../decisions/knowledge/documents/0473-publish-knowledge-within-its-write-scope-and-never-rewrite-a-tool-generated-document.md)). The repository must supply evidence: a `tool_generated` layout role, a declared release-please changelog, `linguist-generated`, a generated-file marker, or a history touched only by automation identities. Inspection, preflight, compilation, and plan validation apply the same exclusion.
- Uses `publication.language`; v1 accepts `en`.
- Takes a document of at most 256 KiB. `lervo migrate knowledge` first splits a larger one, up to 16 MiB, including one the scanner left out for its size. The split is mechanical: each part is an original byte range plus only recorded changes (rebased and anchor-following links, repeated table header rows, copied reference definitions), and a deterministic check undoes them and compares every written file with its range. It never splits a split's index again, and it lists a single block over the bound, a document over 16 MiB, and a document that is not UTF-8 as kept whole instead of passing them over ([ADR-0653](../../decisions/knowledge/semantics/0653-never-let-one-large-document-stop-repository-knowledge.md)).

## Output structure

Every input retains an output at its original path. Ordinary splits use a sibling directory named for the source stem. A size split uses the same directory: `<NN>-<slug>.md` parts, grouped by 32 into numbered directories when there are more, linked from a Lervo-managed `document-parts` block after the preamble that stays at the original path. The root README must not create a root-level `README/` tree; durable detail belongs in the semantic documentation hierarchy. Only declared continuation sources, `HANDOFF.md` or Markdown with `lervo.workstream.continuation: true` front matter, use the bounded handoff profile ([ADR-0476](../../decisions/knowledge/documents/0476-route-legacy-documents-semantically-and-never-migrate-application-content.md)); the selected active source has already entered the workstream stage.

Normalized documents have one H1, except `.github/PULL_REQUEST_TEMPLATE.md`: it never splits, contains no H1, and starts at H2 because GitHub renders the title. All outputs obey byte and line limits. Bridges remain below 2 KiB and 40 lines.

## Preservation and validation

Coverage maps every source section to one or more declared outputs using complete, document-local integer indexes resolved to content-bound versions. Validation preserves:

- Path-scope frontmatter.
- Lifecycle metadata such as `Status:` and `As of:`.
- Managed blocks and provider imports.
- Agent Skill `name`.
- Fenced examples and links in skills and instructions.

Validation rejects inline coordinates in portable skill material, as required by [ADR-0195](../../decisions/knowledge/repository/0195-reviewed-document-content-normalization.md).

Outputs end with exactly one newline. Newly introduced trailing spaces, tabs, or blank lines are rejected. Exact source lines may retain required trailing whitespace only through protected material.

Root README routes agents to `AGENTS.md`; wiki links become portable Markdown. Skill descriptions may be localized without changing identity. Canonical instruction frontmatter remains exact. Further condensation requires exact human review.

Skill resource hashes bind lifecycle and approval; scripts and assets are not rewritten. When reviewed skill prose changes a content-bound project package, the same transaction deterministically refreshes its Lervo manifest content hashes. Manifests are package metadata, not lifecycle resources. Normalization records bind the resulting prose, scripts, references, and assets without becoming immediately stale from the required metadata update.

## Review and apply

Candidates and shard responses remain ignored local state. Cache identity binds the envelope and compiler build. Plans bind exact candidate bytes. Under [ADR-0561](../../decisions/foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md), a foreground apply (`lervo knowledge normalize --candidate <id> --apply <plan-id>`) runs an independent cross-check of the exact plan in a fresh no-capability session instead of per-source approval, then commits the result as its own `Lervo Knowledge` commit that `lervo knowledge revert <commit>` undoes. A disagreement changes nothing.

Normalization debt is background work, not a user or reviewer queue (amended 2026-10-25 by [ADR-0530](../../decisions/knowledge/maintenance/0530-keep-background-knowledge-moving-past-divergent-targets.md)). Documents become pending whenever added or edited after normalization. Background knowledge convergence generates, independently reviews, and applies them. Terminal turns see the pending count only as non-blocking attention; no turn is obliged to advance it. When no background owner runs, Discord repository-work turns in synchronous knowledge mode still receive a stored candidate in their instructions. On request, a turn runs `lervo knowledge normalize --scope all-pending --max-provider-calls 8`, compares each candidate with its source, and applies accepted candidates with their exact approval hashes. A candidate that loses meaning remains unapproved and is reported.

A sandboxed provider turn cannot start a nested provider process. Codex repository-work turns run under `codex exec` with no network and a restricted home, so candidate generation inside them stops at the Codex model-input capability probe (amended 2026-09-26). The Node generates candidates in the background, outside the provider sandbox, using the conversation's configured provider. A Discord turn receives a stored candidate to review with `--candidate <id> --json` and apply with `--candidate <id> --apply <planId>` and its exact approvals; it never runs `--provider`. A turn starting before any candidate exists receives no normalization assignment; a later turn receives the candidate. Applying always requires `--candidate`, including after a terminal `--provider` run.

Apply never reruns the provider. It writes candidates and sharded lifecycle records through the journal, then emits `knowledge.materialization.applied` with `operation=normalize_documents`.

## Planned autonomous continuation

[ADR-0434](../../decisions/knowledge/repository/canonicalization/0434-converge-background-canonicalization-normalization-and-knowledge.md) implements independent agent review under an exact repository delegation, followed by authorized background apply and lifecycle verification. Generation grants neither review nor write authority. The turn-owned review procedure remains current on projects without reviewed version-4 activation and delegation. See the [runtime contract](../background-knowledge-convergence/runtime.md) for autonomous review/apply and the [authority and completion contract](../background-knowledge-convergence/authority-and-completion.md) for its design boundary.
