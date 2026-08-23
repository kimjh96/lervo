# ADR-0190: Language-aware bounded repository publication

## Status

Accepted — 2026-08-23

## Context

Repository migration previously emitted English structural prose incidentally, had no explicit language contract, accumulated every decision link in one navigation file, and created dormant feature directories during initialization. The root README also became a historical ledger rather than a human entrypoint.

Repository discovery cannot be limited to a `docs/` convention. Code, configuration, schemas, tests, logs, agent surfaces, verification results, execution events, and unsupported binary metadata all affect coverage, but they have different privacy and publication rules.

## Decision

- The tracked knowledge policy carries a BCP 47-style `publication.language` identifier. Version 1 supports only `en`; unsupported values fail validation. Every generated README, AGENTS, navigation, count label, and fallback title comes from a locale-independent message catalog, so another language can be added without changing source classification, identity, evidence, or apply contracts. Bundle and concept sidecars record the selected publication language.
- The repository scanner walks every bounded repository file outside explicit generated, dependency, VCS, state, and secret exclusions. Logs are typed separately and treated as sensitive: metadata and hashes may enter local inventory, while raw log bytes do not enter structural publication or an external semantic compiler.
- Generated navigation is bounded by both entry count and UTF-8 byte count. An oversized category becomes a short root index plus numbered pages, and exceptionally large page lists gain catalog pages. Refresh deletes obsolete generated pages only when their current hash matches a recorded generation.
- `lervo init` creates only `.lervo`, `.lervo/knowledge`, the project manifest, the knowledge policy, and the local ignore file. Runtime and feature directories are created when their first artifact is written.
- `lervo migrate knowledge` creates a short English README and canonical AGENTS entrypoint only when they are absent. Existing user-owned entrypoints are preserved. A provider entrypoint such as CLAUDE is created or updated only through an explicit, versioned bridge plan with exact approval.
- The Claude bridge accepts canonical AGENTS bytes only from the bounded user-source scan or from an exact hash recorded by structural generation. A document-free repository can therefore migrate and then create its bridge without treating arbitrary excluded bytes as policy.
- A human README explains purpose, first use, and navigation. AGENTS is optimized for bounded agent discovery and links to deeper contracts. Provider files import or bridge the canonical agent entrypoint instead of duplicating repository policy.
- Generated directories with no desired publications are removed after a successful apply. Empty feature directories are not durable product state.
- Deterministic structural ownership uses one replaceable `.lervo/generated/manifests/current.json`; a successful refresh deletes older valid ID-named structural manifests. Semantic review manifests, events, CAS artifacts, and source-unit history remain separate immutable evidence because they serve review or lineage rather than human navigation.
- Documentation lifecycle checks reject unapproved root Markdown and oversized entrypoints, lifecycle documents, ADRs, research, specifications, and migration notes. `language:audit` inventories non-English documentation, runtime surfaces, metadata, generated knowledge, and test fixtures without printing matched source text.
- Public package descriptions are release identity, not ordinary prose. The first-publication metadata decision now selects the English CLI description, and the exact candidate/permit/apply transaction regenerates the release manifest and SBOM. During the transition, release-manifest validation accepts the recorded legacy description or the reviewed English replacement; direct package or release-manifest patching remains forbidden.
- Human-facing managed-run publication and structured deliberation resolve their writing contract from the same tracked `publication.language`. Version 1 maps `en` to `writing_en-human`; deliberation roles, prompts, exact verdict markers, semantic evaluation, and permits carry that locale instead of embedding a Korean default. Unsupported language identifiers fail closed before execution.

## Ownership and failure meaning

Language changes never grant permission to translate or overwrite user-owned source bytes. Existing entrypoint rewrites require a separately reviewed semantic candidate or an explicit user edit; structural migration only preserves them. A generated output that was edited outside Lervo becomes a conflict and is not deleted or overwritten.

Language selection, navigation limits, source coverage, and delete operations are part of the deterministic plan. Applied events report counts and hashes, never raw repository content or absolute paths.

## Verification

- A document-free repository receives bounded English README, AGENTS, and knowledge entrypoints during migration, not initialization.
- Existing README, AGENTS, and CLAUDE bytes remain unchanged.
- Sixty-one ADR fixtures produce bounded decision pages; removing their sources deletes the recorded pages and empty directory.
- A log fixture appears as sensitive inventory without its secret text appearing in a plan.
- A non-English user filename and heading retain their exact source path while generated English prose uses a neutral localized title; lint ignores identifiers and rejects non-English generated prose.
- A fresh CLI repository completes `init -> migrate knowledge -> Claude bridge -> lint`; the immediate migration replan contains only unchanged operations.
- Repeated structural refresh leaves one current structural generation manifest instead of accumulating one tracked manifest per scan.
- Re-running migration produces only unchanged operations.
- Metadata preview includes the English package description as a separately reviewable change, and candidate, permit, derived-release, transaction, and rollback contract tests preserve the exact-review boundary.
- English managed deliberation converges, rejects an unstructured verdict, runs a stored multi-role policy, and resumes from an approved checkpoint while retaining policy and CAS integrity.

## Research basis

- BCP 47 / RFC 5646 for stable language identifiers.
- Diátaxis for separating tutorials, how-to guides, reference, and explanation rather than growing one mixed document.
- OpenAI Codex AGENTS.md discovery order and bounded instruction loading.
- GitHub guidance that a README is the repository's concise human-facing introduction.
- OpenTelemetry's distinction between log records, resource context, and severity rather than treating logs as ordinary documentation.
