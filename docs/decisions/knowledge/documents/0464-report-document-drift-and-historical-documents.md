# ADR-0464: Report document drift and separate historical documents

Status: `accepted`
Decision date: 2026-10-05
Amends: [ADR-0023](0023-evidence-based-document-staleness.md), [ADR-0192](../repository/0192-repository-scoped-decision-taxonomy.md)

## Context

Another repository ran on Lervo for hours with entrypoints referencing a removed `v2/` tree and `v2/argo_v2/live/engine.py: Limits`, without warnings. The causes were in Lervo:

- `roleBlockers` in `packages/documents/src/document-layout.ts` checks only required roles. `lervo knowledge lint` lacked missing-role and broken-link findings; link checking existed only in this repository's `scripts/quality/check-docs.mjs`.
- `README.md`, `AGENTS.md`, and `CLAUDE.md` are `preserve_user`: Lervo neither rewrote them nor checked their references.
- `evaluateDocumentStaleness` (ADR-0023) had no caller. Only `document_normalization_stale` was wired, which does not detect code drift.
- Initialization seeded Lervo's layout (`docs/product/vision.md`, `docs/architecture/system.md`, `docs/specifications/execution.md`, `docs/roadmap/index.md`) into repositories lacking those files.
- Structural publication recognized only architecture, ADR, specification, and documentation groups. A v1 design in `docs/archive/` appeared as current documentation and ranked in default retrieval.

## Decision

### Drift findings report warnings and never rewrite

`lervo knowledge lint` adds the warning codes below. Each finding contains a repository-relative `path`, optional relative `target`, and stable `reasons`; none contains document bytes, source bytes, or absolute paths. Each code is capped at 64 findings; one `document_reference_findings_truncated` finding counts the remainder. Findings sort by code, path, then target.

| Code | Meaning |
| --- | --- |
| `document_role_target_missing` | A declared, optional, user-owned layout role has no file at its path or legacy aliases. Required roles still fail as `document_role_conflict`. Lervo-owned roles and unmodified Lervo templates are excluded. |
| `markdown_link_target_missing` | A relative Markdown link in an included current document names a nonexistent file or directory. URLs, schemes, protocol-relative links, anchor-only links, and targets in generated, ignored, publication, or `.lervo/state/` paths are excluded. |
| `entrypoint_reference_missing` | User-owned prose in root `README.md`, `AGENTS.md`, or `CLAUDE.md` names a missing repository path (`path_missing`). A `path: Symbol` reference reports `symbol_missing` when its file exists, is at most 1 MiB, and no longer contains the symbol as a whole identifier. Every Lervo-managed block is skipped, regardless of schema version. |
| `document_stale` | The ADR-0023 evaluator proves a document stale against its verified revision. The finding carries evaluator reasons and up to five changed connected paths. |
| `document_staleness_unknown` | One aggregate finding counts documents with unknown evidence. Unknown never counts as current. |

Findings never change validity or authorize writes. A separate, later decision owns evidence-bound document updates.

### Reference inference

`document-references.ts` extracts these reference kinds, skipping fenced code bodies:

- `markdown_link`: inline links, images, and reference definitions. Remove fragments and queries. Resolve against the document directory, or the repository root for targets starting with `/`. Drop targets escaping the repository.
- `code_path`: an inline code span containing a repository-root-relative path with at least one `/`. Whitespace, glob or placeholder characters, schemes, and `..` are prohibited. Remove a `:line[:column]` suffix. Paths with a file extension or trailing `/` are strong; other paths are weak and count only when their first segment exists at the repository root.
- `code_symbol`: an inline code span `path: Symbol` containing a strong path and an identifier, which may be dotted.
- `fence_path`: a fence info string naming a strong path directly or through `title=`, `file=`, or `path=`.

### Staleness wiring

Every included current Markdown document is a candidate. Infer its manifest as follows:

- `verifiedRevision`: the later of two first-parent commits—the last to change the document's bytes and the last to change a tracked normalization record naming it as an output. Use `git log --first-parent --diff-merges=first-parent` for both. `verifiedAt` is that commit's time.
- `connectedPaths`: the document's references, excluding Markdown targets, the document itself, ancestor directories, ignored or generated paths, and weak paths whose first segment is absent at the root. Sort and cap at 32. Drop a path absent at both HEAD and the verified revision.
- `reviewIntervalDays`: 365. Ownership: `user`.

Snapshots map each relative path to the `sha256` of its Git object name at HEAD and the verified revision. Directories map to tree objects, so any internal change changes their entries. Evaluate only committed bytes. Documents with no history or connected path count as `unevaluated`, never current. Repositories without Git history report `unavailable`.

`lintRepositoryKnowledge` evaluates staleness read-only, except during transaction-plan validation, where it skips staleness because stage checks compare errors only. Repository knowledge currency, run by the background knowledge pass and lifecycle verification, uses `evaluate_and_record`. This mode writes the rebuildable projection `.lervo/state/knowledge/document-staleness.json`.

The projection key covers evaluator version, HEAD, UTC day, document path and content-hash set, and normalization outputs. Lint reuses matching projections. `readRecordedDocumentStalenessReport` returns the last projection to later consumers. Its `stale` and `unknown` lists are each capped at 256 entries carrying `path`, `verifiedRevision`, `reasons`, `connectedPaths`, and `changedPaths`. Consumers must compare `currentRevision` with the revision they act on.

### Attention

`documentDriftAttentionIssues` maps these codes to bounded `{ code, command, detail }` lifecycle issues, plus one `document_drift_attention_truncated` item. It selects findings round-robin across codes in this priority order: `entrypoint_reference_missing`, `document_stale`, `markdown_link_target_missing`, `document_role_target_missing`, `document_staleness_unknown`. One prolific code cannot hide the others. `detail` contains only `path=`, `target=`, and `reasons=`; `command` is `lervo knowledge lint --json`.

The terminal validation lifecycle in `apps/cli/src/terminal-knowledge-lifecycle-inspection.ts` derives at most four items from its lint call and returns them as `advisories`, separate from lifecycle `issues`. Advisories never change `TerminalLifecycleInspection.status` or block a Stop, worker checkpoint, or turn declaration. The exact-revision lifecycle cache stores them in an optional `advisories` field.

Operating attention appends them to knowledge-lifecycle issues in both `lervo application attention` and the cached prompt-path projection. The projection derives `actionOwner: "agent"`, `requiresUserAction: false`, and `blocking: false` for these codes. They have no consequence class and remain within the twelve-item, 4 KiB terminal attention budget.

### Historical documents

A document is historical if any condition holds:

- `archive_scope`: its path is under `docs/archive/` or a capacity override with role `archive`.
- `front_matter`: leading YAML front matter sets `status:` or `lifecycle:` to `historical`, `archived`, or `superseded`, or sets `historical: true` or `archived: true`.
- `banner`: one of the first three non-empty body lines is a blockquote whose text, after emphasis markers, starts with `Historical`, `Archived`, or `Superseded`, followed by `.`, `:`, `(`, a dash, or end of line.

Structural publication places historical documentation in a `historical` group titled "Historical documents (not current design)", with each entry labelled `historical, not current design`. Default knowledge retrieval excludes historical concepts on both compatibility and ranker paths. Queries containing any whole word `archive`, `archived`, `historical`, `history`, `legacy`, `superseded`, `obsolete`, or `deprecated` include them and label each hit `historical: true`. Reference and staleness checks skip historical documents as frozen records.

### Layout role seeding

`product_vision`, `system_architecture`, `execution_specification`, and `delivery_roadmap` become conditional templates. Initialization seeds each only when its path or a legacy alias exists. `public_overview` and Lervo-owned `continuation_source` are always seeded.

The layout migration plan prunes an unmodified template when its path and all aliases are absent. It re-adds a template only when the plan moves a recognized document to the template path. Both changes use one Lervo-managed `.lervo/knowledge/document-layout.yaml` update with reason `bind_document_role_templates`, or `upgrade_document_policy` when accompanied by a legacy upgrade. Repository-edited or repository-declared roles are never pruned or restored.

## Consequences

Repositories see broken references, removed layout targets, and code drift without changes to user-owned bytes. Existing installations receive one reviewed layout update on their next knowledge migration. Historical designs stop competing with current designs in navigation and retrieval. Staleness depends on Git history: shallow clones and uncommitted edits report less, never more.
