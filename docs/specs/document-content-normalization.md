# Document content normalization

Status: `active`
As of: 2026-08-27

## Contract

After canonical bootstrap, layout, and bridges are current, `migrate knowledge --provider codex|claude` uses the same boundary to return bounded Markdown candidates. Entrypoint adoption and bridge disposition remain independent of prose normalization.

V1 covers ordinary `.md` files outside generated navigation and `.changes/`. Profiles distinguish README, agent instruction, bridge, portable skill or reference, decision, product, architecture, specification, roadmap, instruction, pull-request template, and general documents. Release intents and the replace-in-place current release note retain release ownership and never enter provider normalization. Output follows `publication.language`; v1 accepts `en`.

Every input retains an output at its path. Ordinary splits use a sibling directory named for the source stem. The root README does not create a root-level `README/` tree; durable detail belongs in the semantic documentation hierarchy. Historical continuation documents may use the bounded handoff profile based on content, while the selected active source has already entered the workstream stage. Normalized documents have one H1 except `.github/PULL_REQUEST_TEMPLATE.md`, which never splits, contains no H1, and starts at H2 because GitHub renders the title. All outputs obey byte and line limits; bridges stay below 2 KiB and 40 lines.

Coverage maps every source section to one or more declared outputs using complete, document-local integer indexes resolved to content-bound versions. Validation preserves path-scope frontmatter, lifecycle metadata such as `Status:` and `As of:`, managed blocks, provider imports, Agent Skill `name`, fenced examples and links in skills and instructions, and portable inline coordinates. Outputs end with exactly one newline; newly introduced trailing spaces, tabs, or blank lines are rejected. Exact source lines may retain required trailing whitespace only through protected material. Root README routes agents to `AGENTS.md`; wiki links become portable Markdown. Skill descriptions may be localized without changing identity. Canonical instruction frontmatter stays exact. Further condensation requires exact human review. Skill resource hashes bind lifecycle and approval; scripts and assets are not rewritten.

Candidates and shard responses remain ignored local state. Cache identity binds the envelope and compiler build. Plans bind exact candidate bytes and require per-source approval. Apply never reruns the provider: it writes candidates and sharded lifecycle records through the journal, then emits `knowledge.materialization.applied` with `operation=normalize_documents`.

Records bind output and resource hashes plus a user-region hash that excludes managed blocks. Replacement retires older records, and the same transaction refreshes registered rewrite configuration. Post-apply lint failure rolls back; later byte mismatches become stale and require review.

Repository document layout follows [ADR-0222](../decisions/knowledge/repository/0222-bounded-role-based-document-layout.md). One tree evaluator serves planning, lint and durable permits. Tracked roles locate human documents; provider adapters alone locate provider entrypoints. Bounded rewrite descriptors reconcile byte owners, while unobserved rewrites remain unmanaged.

## References

- [Repository knowledge compilation](repository-knowledge-compilation.md)
- [Reviewed document content normalization](../decisions/knowledge/repository/0195-reviewed-document-content-normalization.md)
- [Bounded role-based document layout](../decisions/knowledge/repository/0222-bounded-role-based-document-layout.md)
