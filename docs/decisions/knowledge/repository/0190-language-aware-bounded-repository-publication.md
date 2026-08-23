# ADR-0190: Language-aware bounded repository publication

## Status

Accepted — 2026-08-23

## Context

Repository migration previously emitted incidental English structural prose, lacked an explicit language contract, accumulated every decision link in one navigation file, created dormant feature directories during initialization, and turned the root README into a historical ledger.

Discovery cannot be limited to `docs/`. Code, configuration, schemas, tests, logs, agent surfaces, verification results, execution events, and unsupported binary metadata affect coverage but require different privacy and publication rules.

## Decision

- The tracked knowledge policy carries a BCP 47-style `publication.language`. Version 1 supports only `en`; other values fail validation. A locale-independent message catalog supplies every generated README, AGENTS, navigation element, count label, and fallback title. Bundle and concept sidecars record the selected language.
- The scanner walks every bounded repository file outside explicit generated, dependency, VCS, state, and secret exclusions. Logs are sensitive: metadata and hashes may enter local inventory, but raw bytes never enter structural publication or an external semantic compiler.
- Navigation is bounded by entry count and UTF-8 byte count. Oversized categories use a short root index and numbered pages; exceptionally large page lists use catalog pages. Refresh deletes obsolete generated pages only when their current hashes match recorded generations.
- `lervo init` creates only `.lervo`, `.lervo/knowledge`, the project manifest, knowledge policy, and local ignore file. Runtime and feature directories remain lazy.
- `lervo migrate knowledge` creates a short English README and canonical AGENTS entrypoint only when absent. Existing user-owned entrypoints remain unchanged. Provider entrypoints such as CLAUDE require an explicit, versioned bridge plan with exact approval.
- The Claude bridge accepts canonical AGENTS bytes only from the bounded user-source scan or an exact structural-generation hash. A document-free repository can migrate and create its bridge without treating excluded bytes as policy.
- README explains purpose, first use, and navigation. AGENTS provides bounded agent discovery and deeper contract links. Provider files import or bridge the canonical entrypoint instead of duplicating policy.
- After successful apply, generated directories with no desired publications are removed. Empty feature directories are not durable state.
- Structural ownership uses one replaceable `.lervo/generated/manifests/current.json`. Successful refresh deletes older valid ID-named structural manifests. Semantic review manifests, events, CAS artifacts, and source-unit history remain separate immutable review or lineage evidence.
- Lifecycle checks reject unapproved root Markdown and oversized entrypoints, lifecycle documents, ADRs, research, specifications, and migration notes. `language:audit` inventories non-English documentation, runtime surfaces, metadata, generated knowledge, and fixtures without printing matched source text.
- Public package descriptions are release identity. The first-publication metadata decision selects the English CLI description, and the exact candidate/permit/apply transaction regenerates the release manifest and SBOM. During transition, release-manifest validation accepts the recorded legacy description or reviewed English replacement. Direct package or release-manifest patching remains forbidden.
- Managed-run publication and structured deliberation resolve their writing contract from the same `publication.language`. Version 1 maps `en` to `writing_en-human`; roles, prompts, exact verdict markers, semantic evaluation, and permits carry that locale. Unsupported identifiers fail closed before execution.

## Ownership and failure meaning

Language selection never authorizes translation or replacement of user-owned bytes. Existing entrypoint rewrites require a separately reviewed semantic candidate or explicit user edit; structural migration only preserves them. Externally edited generated output is a conflict and is neither deleted nor overwritten.

Language, navigation limits, source coverage, and deletions belong to the deterministic plan. Applied events report counts and hashes, never raw content or absolute paths.

## Verification

- Document-free migration creates bounded English README, AGENTS, and knowledge entrypoints; initialization does not.
- Existing README, AGENTS, and CLAUDE bytes remain unchanged.
- Sixty-one ADR fixtures create bounded decision pages; removing sources deletes recorded pages and the empty directory.
- A log fixture appears as sensitive inventory without leaking its secret text into a plan.
- Non-English user paths and headings remain exact while generated English uses neutral localized titles; lint ignores identifiers and rejects non-English generated prose.
- A fresh CLI repository completes `init -> migrate knowledge -> Claude bridge -> lint`; immediate replanning contains only unchanged operations.
- Repeated refresh retains one current structural manifest.
- Repeated migration yields only unchanged operations.
- Metadata preview exposes the English package description separately, while candidate, permit, derived-release, transaction, and rollback tests preserve exact review.
- English deliberation converges, rejects unstructured verdicts, runs stored multi-role policy, and resumes approved checkpoints while preserving policy and CAS integrity.

## Research basis

- BCP 47 / RFC 5646 for stable language identifiers.
- Diátaxis for separating tutorials, how-to guides, reference, and explanation.
- OpenAI Codex AGENTS.md discovery order and bounded instruction loading.
- GitHub guidance for concise human-facing READMEs.
- OpenTelemetry's distinction among log records, resource context, and severity.
