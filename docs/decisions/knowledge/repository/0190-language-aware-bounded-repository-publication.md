# ADR-0190: Language-aware bounded repository publication

## Status

Accepted — 2026-08-23

## Context

Migration emitted incidental English prose, lacked a language contract, accumulated decision links in one file, created dormant directories, and turned README into a ledger. Discovery also cannot be limited to `docs/`: code, configuration, schemas, tests, logs, agent surfaces, verification, events, and binary metadata affect coverage under different privacy rules.

## Decision

- Tracked policy carries BCP 47-style `publication.language`. V1 supports only `en`; other values fail validation. A locale-independent catalog supplies all generated README, AGENTS, navigation, count, and fallback text. Bundle and concept sidecars record the language.
- The scanner walks bounded repository files outside explicit generated, dependency, VCS, state, and secret exclusions. Sensitive logs contribute only metadata and hashes to local inventory; raw bytes never enter structural publication or external semantic compilation.
- Navigation is bounded by entry count and UTF-8 bytes. Oversized categories use short indexes and numbered pages; exceptionally large lists use catalogs. Refresh deletes obsolete pages only when their current hashes match recorded generation.
- `lervo init` creates only `.lervo`, `.lervo/knowledge`, the project manifest, knowledge policy, and local ignore file. Runtime and feature directories remain lazy.
- `lervo migrate knowledge` creates short English README and AGENTS entrypoints only when absent. Existing user-owned entrypoints remain unchanged. CLAUDE requires a separate versioned bridge plan with exact approval.
- The Claude bridge accepts canonical AGENTS bytes only from the bounded user-source scan or an exact structural-generation hash. Document-free repositories may create the bridge without treating excluded bytes as policy.
- README covers purpose, first use, and navigation. AGENTS provides bounded discovery and deeper contract links. Provider files bridge the canonical entrypoint instead of duplicating policy.
- Successful apply removes generated directories that have no desired publications. Empty feature directories are not durable state.
- Structural ownership originally used one replaceable `.lervo/generated/manifests/current.json`. ADR-0303 and compiler schema 2 relocate that manifest and unreviewed structural projections to ignored `.lervo/state/knowledge/current/`; semantic review manifests, events, CAS artifacts, and source-unit history remain separate immutable evidence.
- Generated navigation labels the structural publication-input snapshot, excluding revision metadata, verification, events, and local-inventory-only agent surfaces. A different full query snapshot does not imply staleness; the current manifest and a zero-change migration plan determine currency.
- Lifecycle rejects unapproved root Markdown and oversized entrypoints, lifecycle documents, ADRs, research, specifications, and migration notes. `language:audit` inventories non-English documentation, runtime surfaces, metadata, generated knowledge, and fixtures without printing matched text.
- Public package descriptions are release identity. The first-publication metadata decision selects the English CLI description; the exact candidate/permit/apply transaction regenerates the release manifest and SBOM. During transition, validation accepts the recorded legacy description or reviewed replacement. Direct package or release-manifest patching is forbidden.
- Managed-run publication and deliberation resolve writing from `publication.language`. V1 maps `en` to `writing_en-human`; roles, prompts, verdict markers, semantic evaluation, and permits carry the locale. Unsupported identifiers fail closed before execution.

## Ownership and failure meaning

Language never authorizes translating or replacing user-owned bytes. Existing entrypoint rewrites require a reviewed semantic candidate or explicit user edit; structural migration preserves them. Externally edited generated output conflicts and is neither deleted nor overwritten.

Language, navigation limits, coverage, and deletions belong to the deterministic plan. Applied events report counts and hashes, never raw content or absolute paths.

## Verification

- Document-free migration creates bounded English README, AGENTS, and knowledge entrypoints; initialization does not.
- Existing README, AGENTS, and CLAUDE bytes remain unchanged.
- Sixty-one ADR fixtures create bounded pages; source removal deletes recorded pages and the empty directory.
- A log fixture appears as sensitive inventory without leaking secret text.
- Non-English paths and headings remain exact; generated English uses neutral localized titles. Lint ignores identifiers and rejects non-English generated prose.
- A fresh CLI repository completes `init -> migrate knowledge -> Claude bridge -> lint`; immediate replanning is unchanged.
- Repeated refresh retains one current structural manifest; repeated migration yields only unchanged operations.
- Metadata preview separates the English package description; candidate, permit, derived-release, transaction, and rollback tests preserve exact review.
- English deliberation converges, rejects unstructured verdicts, runs stored multi-role policy, and resumes approved checkpoints while preserving policy and CAS integrity.

## Research basis

- BCP 47 / RFC 5646 for language identifiers.
- Diátaxis for documentation separation.
- OpenAI Codex AGENTS.md discovery and bounded loading.
- GitHub guidance for concise READMEs.
- OpenTelemetry's distinction among log records, resource context, and severity.
