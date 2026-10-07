# Preservation and validation

Coverage maps every source section to one or more declared outputs using complete, document-local integer indexes resolved to content-bound versions. Validation preserves:

- Path-scope frontmatter.
- Lifecycle metadata such as `Status:` and `As of:`.
- Managed blocks and provider imports.
- Agent Skill `name`.
- Fenced examples and links in skills and instructions.

Validation rejects inline coordinates in portable skill material, as required by [ADR-0195](../../../decisions/knowledge/repository/0195-reviewed-document-content-normalization.md).

Outputs end with exactly one newline. Newly introduced trailing spaces, tabs, or blank lines are rejected. Exact source lines may retain required trailing whitespace only through protected material.

Root README routes agents to `AGENTS.md`; wiki links become portable Markdown. Skill descriptions may be localized without changing identity. Canonical instruction frontmatter remains exact. Further condensation requires exact human review.

Skill resource hashes bind lifecycle and approval; scripts and assets are not rewritten. When reviewed skill prose changes a content-bound project package, the same transaction deterministically refreshes its Lervo manifest content hashes. Manifests are package metadata, not lifecycle resources. Normalization records bind the resulting prose, scripts, references, and assets without becoming immediately stale from the required metadata update.
