# ADR-0464: Report document drift and separate historical documents

Status: `accepted`
Decision date: 2026-10-05
Amends: [ADR-0023](0023-evidence-based-document-staleness.md), [ADR-0192](../repository/0192-repository-scoped-decision-taxonomy.md)

## Context

Another repository ran on Lervo for hours with entrypoints referencing a removed `v2/` tree and `v2/argo_v2/live/engine.py: Limits`, without warnings. Lervo had five gaps:

- `roleBlockers` in `packages/documents/src/document-layout.ts` checked only required roles. `lervo knowledge lint` lacked missing-role and broken-link findings; link checking existed only in this repository's `scripts/quality/check-docs.mjs`.
- `README.md`, `AGENTS.md`, and `CLAUDE.md` were `preserve_user`: Lervo neither rewrote them nor checked their references.
- `evaluateDocumentStaleness` (ADR-0023) had no caller. Only `document_normalization_stale` was wired, which says nothing about code drift.
- Initialization seeded Lervo's layout paths—`docs/product/vision.md`, `docs/architecture/system.md`, `docs/specifications/execution.md`, `docs/roadmap/index.md`—into repositories without those files.
- Structural publication recognized only architecture, ADR, specification, and documentation groups. A v1 design in `docs/archive/` appeared current and ranked in default retrieval.

## Decision

### Drift findings report warnings without rewriting

Add the following warning codes to `lervo knowledge lint`. Each finding contains a repository-relative `path`, optional relative `target`, and stable `reasons`; never document bytes, source bytes, or absolute paths. Cap each code at 64 findings and count the remainder in one `document_reference_findings_truncated` finding. Sort by code, path, then target.

| Code | Meaning |
| --- | --- |
| `document_role_target_missing` | A declared, optional, user-owned layout role has no file at its path or legacy aliases. Required roles still fail as `document_role_conflict`. Exclude Lervo-owned roles and unmodified Lervo templates. |
| `markdown_link_target_missing` | A relative Markdown link in an included current document names a missing file or directory. Exclude URLs, schemes, protocol-relative links, anchor-only links, and targets in generated, ignored, publication, or `.lervo/state/` paths. |
| `entrypoint_reference_missing` | User-owned prose in root `README.md`, `AGENTS.md`, or `CLAUDE.md` names a missing repository path (`path_missing`). For `path: Symbol`, report `symbol_missing` when the file exists, is at most 1 MiB, and lacks the symbol as a whole identifier. Skip all Lervo-managed blocks, regardless of schema version. |
| `document_stale` | The ADR-0023 evaluator proves staleness against the document's verified revision. Include evaluator reasons and up to five changed connected paths. |
| `document_staleness_unknown` | One aggregate finding counts documents with unknown evidence. Unknown never counts as current. |

Findings never change validity or authorize writes. A separate, later decision owns evidence-bound document updates.

### Reference inference

`document-references.ts` extracts the following kinds, skipping fenced code bodies:

- `markdown_link`: inline links, images, and reference definitions. Remove fragment and query; resolve against the document directory, or repository root for targets starting with `/`. Drop targets escaping the repository.
- `code_path`: an inline code span containing a repository-root-relative path with at least one `/`. Disallow whitespace, glob or placeholder characters, schemes, and `..`. Remove a `:line[:column]` suffix. A path is strong if it has a file extension or ends with `/`; otherwise it is weak and counts only when its first segment exists at repository root.
- `code_symbol`: an inline code span `path: Symbol` containing a strong path and an identifier, optionally dotted.
- `fence_path`: a fence info string naming a strong path directly or through `title=`, `file=`, or `path=`.

### Staleness wiring

Every included current Markdown document is a candidate. Infer its manifest:

- `verifiedRevision`: the later of two first-parent commits—the last to change document bytes and the last to change a tracked normalization record naming the document as output. Use `git log --first-parent --diff-merges=first-parent` for both. Set `verifiedAt` to that commit's time.
- `connectedPaths`: document references excluding Markdown targets, the document itself, ancestor directories, ignored or generated paths, and weak paths whose first segment is absent at root. Sort and cap at 32. Drop paths absent at both HEAD and the verified revision.
- `reviewIntervalDays`: 365. Ownership: `user`.

Snapshots map relative paths to `sha256` of their Git object names at HEAD and the verified revision. A directory maps to its tree object, so any internal change changes the entry. Evaluate only committed bytes. Documents without history or connected paths count as `unevaluated`, never current. Repositories without Git history report `unavailable`.

`lintRepositoryKnowledge` evaluates staleness read-only. Skip staleness during transaction-plan validation because stage checks compare errors only. Repository knowledge currency, run by the background knowledge pass and lifecycle verification, uses `evaluate_and_record` to write the rebuildable `.lervo/state/knowledge/document-staleness.json` projection.

The projection key covers evaluator version, HEAD, UTC day, document path and content-hash set, and normalization outputs. Lint reuses matching projections. `readRecordedDocumentStalenessReport` returns the latest projection for later consumers. Its `stale` and `unknown` lists each hold at most 256 entries with `path`, `verifiedRevision`, `reasons`, `connectedPaths`, and `changedPaths`. Consumers must compare `currentRevision` with the revision they act on.

### Attention

`documentDriftAttentionIssues` maps warning codes to bounded `{ code, command, detail }` lifecycle issues, plus one `document_drift_attention_truncated` item. Select findings round-robin across codes in this priority order:

1. `entrypoint_reference_missing`
2. `document_stale`
3. `markdown_link_target_missing`
4. `document_role_target_missing`
5. `document_staleness_unknown`

This prevents one prolific code from hiding others. `detail` contains only `path=`, `target=`, and `reasons=`; `command` is `lervo knowledge lint --json`.

The terminal validation lifecycle in `apps/cli/src/terminal-knowledge-lifecycle-inspection.ts` derives at most four items from lint and returns them as `advisories`, separate from lifecycle `issues`. Advisories never change `TerminalLifecycleInspection.status` or block a Stop, worker checkpoint, or turn declaration. The exact-revision lifecycle cache stores them in optional `advisories`.

Operating attention appends these items to knowledge-lifecycle issues in both `lervo application attention` and the cached prompt-path projection. For these codes, the projection derives `actionOwner: "agent"`, `requiresUserAction: false`, and `blocking: false`. They have no consequence class and remain within the twelve-item, 4 KiB terminal attention budget.

### Historical documents

A document is historical when any condition holds:

- `archive_scope`: its path is under `docs/archive/` or a capacity override with role `archive`.
- `front_matter`: leading YAML front matter sets `status:` or `lifecycle:` to `historical`, `archived`, or `superseded`, or sets `historical: true` or `archived: true`.
- `banner`: one of the first three non-empty body lines is a blockquote whose text, after emphasis markers, starts with `Historical`, `Archived`, or `Superseded`, followed by `.`, `:`, `(`, a dash, or end of line.

Structural publication places these documents in the `historical` group, titled "Historical documents (not current design)", and labels each entry `historical, not current design`.

Default knowledge retrieval excludes historical concepts on both compatibility and ranker paths. Queries containing any whole word `archive`, `archived`, `historical`, `history`, `legacy`, `superseded`, `obsolete`, or `deprecated` include them and label each hit `historical: true`. Reference and staleness checks skip historical documents as frozen records.

### Layout role seeding

Make `product_vision`, `system_architecture`, `execution_specification`, and `delivery_roadmap` conditional templates: initialization seeds each only if its path or a legacy alias exists. Always seed `public_overview` and Lervo-owned `continuation_source`.

The layout migration plan prunes an unmodified template when its path and all aliases are absent. Re-add a template only when the plan moves a recognized document to its template path. Apply both changes through one Lervo-managed `.lervo/knowledge/document-layout.yaml` update with reason `bind_document_role_templates`, or `upgrade_document_policy` if a legacy upgrade occurs simultaneously. Never prune or restore a repository-edited or repository-declared role.

## Consequences

Repositories see broken references, removed layout targets, and code drift without changes to user-owned bytes. Existing installations receive one reviewed layout update on their next knowledge migration. Historical designs no longer compete with current designs in navigation and retrieval. Staleness evidence depends on Git history: shallow clones and uncommitted edits report less, never more.
