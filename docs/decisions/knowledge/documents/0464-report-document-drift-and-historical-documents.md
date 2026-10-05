# ADR-0464: Report document drift and separate historical documents

Status: `accepted`
Decision date: 2026-10-05
Amends: [ADR-0023](0023-evidence-based-document-staleness.md), [ADR-0192](../repository/0192-repository-scoped-decision-taxonomy.md)

## Context

Another repository ran on Lervo for hours with entrypoints that pointed at a removed `v2/` tree and at `v2/argo_v2/live/engine.py: Limits`, and nothing warned anyone. The causes were in Lervo:

- `roleBlockers` in `packages/documents/src/document-layout.ts` checks only required roles. `lervo knowledge lint` had no missing-role or broken-link finding; link checking existed only in this repository's own `scripts/quality/check-docs.mjs`.
- `README.md`, `AGENTS.md`, and `CLAUDE.md` are `preserve_user`. Lervo never rewrites them and never checked what they reference.
- `evaluateDocumentStaleness` (ADR-0023) had no caller. Only `document_normalization_stale` was wired, and it says nothing about drift from code.
- Initialization seeded Lervo's own layout (`docs/product/vision.md`, `docs/architecture/system.md`, `docs/specifications/execution.md`, `docs/roadmap/index.md`) into repositories that have none of those files.
- Structural publication knew only architecture, ADR, specification, and documentation groups. A v1 design under `docs/archive/` appeared as current documentation and ranked in default retrieval.

## Decision

### Drift findings are warnings that report and never rewrite

`lervo knowledge lint` adds these warning codes. Each finding has a repository-relative `path`, an optional relative `target`, and stable `reasons`. Findings never contain document bytes, source bytes, or absolute paths. Each code is bounded to 64 findings, and one `document_reference_findings_truncated` finding counts the rest. Findings are ordered by code, then path, then target.

| Code                           | Meaning                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `document_role_target_missing` | A declared, optional, user-owned layout role has no file at its path or legacy aliases. Required roles still fail as `document_role_conflict`. Lervo-owned roles and unmodified Lervo templates are not reported.                                                                                                                       |
| `markdown_link_target_missing` | A relative Markdown link in an included current document names a file or directory that does not exist. URLs, schemes, protocol-relative links, anchor-only links, and targets in generated, ignored, publication, or `.lervo/state/` paths are not checked.                                                                            |
| `entrypoint_reference_missing` | User-owned prose in the root `README.md`, `AGENTS.md`, or `CLAUDE.md` names a missing repository path (`path_missing`). A `path: Symbol` reference whose file exists, is at most 1 MiB, and no longer contains the symbol as a whole identifier reports `symbol_missing`. Every Lervo-managed block, of any schema version, is skipped. |
| `document_stale`               | The ADR-0023 evaluator proves a document stale against its verified revision. The finding carries evaluator reasons and up to five changed connected paths.                                                                                                                                                                             |
| `document_staleness_unknown`   | One aggregate finding counts documents whose evidence is unknown. Unknown never counts as current.                                                                                                                                                                                                                                      |

Findings never change validity, and no finding authorizes a write. A separate, later decision owns evidence-bound document updates.

### Reference inference

`document-references.ts` extracts these reference kinds. Fenced code bodies are skipped.

- `markdown_link`: inline links, images, and reference definitions. The fragment and query are removed. A target resolves against the document directory, or against the repository root when it starts with `/`. A target that escapes the repository is dropped.
- `code_path`: an inline code span holding a repository-root-relative path with at least one `/`. It may not contain whitespace, glob or placeholder characters, a scheme, or `..`. A `:line[:column]` suffix is removed. The path is strong when it has a file extension or ends with `/`. Otherwise it is weak and counts only when its first segment exists at the repository root.
- `code_symbol`: an inline code span `path: Symbol` with a strong path and an identifier, which may be dotted.
- `fence_path`: a fence info string that names a strong path directly or as `title=`, `file=`, or `path=`.

### Staleness wiring

Every included current Markdown document is a candidate. Its manifest is inferred as follows:

- `verifiedRevision` is the later of two first-parent commits: the last one that changed the document's bytes and the last one that changed a tracked normalization record naming the document as an output. `git log --first-parent --diff-merges=first-parent` supplies both. `verifiedAt` is that commit's time.
- `connectedPaths` are the document's references minus Markdown targets, the document itself, its ancestor directories, ignored or generated paths, and weak paths whose first segment is absent at the root. They are sorted and capped at 32. A path absent at both HEAD and the verified revision is dropped.
- `reviewIntervalDays` is 365. Ownership is `user`.

Snapshots map each relative path to `sha256` of its Git object name at HEAD and at the verified revision. A directory maps to its tree object, so any change inside it changes the entry. Only committed bytes are evaluated. A document with no history or no connected path is counted `unevaluated` and is never treated as current. A repository without Git history reports status `unavailable`.

`lintRepositoryKnowledge` evaluates staleness in read-only mode. It skips staleness when a transaction plan is under validation, because stage checks compare errors only. Repository knowledge currency, which the background knowledge pass and lifecycle verification run, uses `evaluate_and_record`. That mode writes the rebuildable projection `.lervo/state/knowledge/document-staleness.json`. The projection's key covers the evaluator version, HEAD, the UTC day, the document path and content-hash set, and normalization outputs. Lint reuses a matching projection. `readRecordedDocumentStalenessReport` returns the last projection to later consumers. Its `stale` and `unknown` lists, each bounded to 256 entries, carry `path`, `verifiedRevision`, `reasons`, `connectedPaths`, and `changedPaths`. Consumers must compare `currentRevision` with the revision they act on.

### Attention

`documentDriftAttentionIssues` maps these codes to at most 16 `{ code, command, detail }` lifecycle issues, plus one `document_drift_attention_truncated` item. `detail` holds only `path=`, `target=`, and `reasons=`. The operating-attention projection already derives `actionOwner: "agent"` for such codes, so they become agent-owned `knowledge_lifecycle` items. The integration point is the terminal validation lifecycle in `apps/cli/src/terminal-knowledge-lifecycle-inspection.ts`, which appends them after its lint call. The terminal and operating-attention workstream owns that wiring.

### Historical documents

A document is historical when any of these holds:

- `archive_scope`: the path is under `docs/archive/` or under a capacity override whose role is `archive`.
- `front_matter`: leading YAML front matter has `status:` or `lifecycle:` set to `historical`, `archived`, or `superseded`, or has `historical: true` or `archived: true`.
- `banner`: one of the first three non-empty body lines is a blockquote. After emphasis markers, its text starts with `Historical`, `Archived`, or `Superseded`, followed by `.`, `:`, `(`, a dash, or the end of the line.

Structural publication puts historical documentation in a `historical` group, titled "Historical documents (not current design)". Each entry is labelled `historical, not current design`. Default knowledge retrieval excludes historical concepts on both the compatibility and ranker paths. A query that contains `archive`, `archived`, `historical`, `history`, `legacy`, `superseded`, `obsolete`, or `deprecated` as a whole word includes them and labels each hit `historical: true`. Reference and staleness checks skip historical documents because they are frozen records.

### Layout role seeding

`product_vision`, `system_architecture`, `execution_specification`, and `delivery_roadmap` become conditional templates. Initialization seeds a template only when its path or a legacy alias exists. `public_overview` and the Lervo-owned `continuation_source` are always seeded.

The layout migration plan prunes an unmodified template whose path and aliases are all absent. It re-adds a template only when the plan moves a recognized document to the template path. Both changes go through one Lervo-managed `.lervo/knowledge/document-layout.yaml` update with reason `bind_document_role_templates`, or `upgrade_document_policy` when a legacy upgrade happens at the same time. A role a repository edited or declared is never pruned or restored.

## Consequences

Repositories now see broken references, removed layout targets, and code drift without any user-owned bytes changing. Existing installations receive one reviewed layout update on their next knowledge migration. Historical designs stop competing with current ones in navigation and retrieval. Staleness stays as good as Git history: shallow clones and uncommitted edits report less, never more.
