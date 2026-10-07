# Scope and output structure

## V1 scope

- Covers ordinary `.md` files outside generated navigation and `.changes/`.
- Distinguishes README, agent instruction, bridge, portable skill or reference, decision, product, architecture, specification, roadmap, instruction, pull-request template, and general document profiles.
- Excludes release intents and the replace-in-place current release note from provider normalization; both retain release ownership.
- Excludes tool-generated documents ([ADR-0473](../../../decisions/knowledge/documents/0473-publish-knowledge-within-its-write-scope-and-never-rewrite-a-tool-generated-document.md)). The repository must supply evidence: a `tool_generated` layout role, a declared release-please changelog, `linguist-generated`, a generated-file marker, or a history touched only by automation identities. Inspection, preflight, compilation, and plan validation apply the same exclusion.
- Uses `publication.language`; v1 accepts `en`.

## Output structure

Every input retains an output at its original path. Ordinary splits use a sibling directory named for the source stem. The root README must not create a root-level `README/` tree; durable detail belongs in the semantic documentation hierarchy.

Only declared continuation sources—`HANDOFF.md` or Markdown with `lervo.workstream.continuation: true` front matter—use the bounded handoff profile ([ADR-0476](../../../decisions/knowledge/documents/0476-route-legacy-documents-semantically-and-never-migrate-application-content.md)). The selected active source has already entered the workstream stage.

Normalized documents have one H1, except `.github/PULL_REQUEST_TEMPLATE.md`: it never splits, contains no H1, and starts at H2 because GitHub renders the title. All outputs obey byte and line limits. Bridges remain below 2 KiB and 40 lines.
