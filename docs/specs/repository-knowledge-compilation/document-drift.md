# Document Drift and Historical Documents

This specification covers how `lervo knowledge lint` reports drift between repository documents and the repository they describe, and how historical documents are kept out of current navigation. [ADR-0464](../../decisions/knowledge/documents/0464-report-document-drift-and-historical-documents.md) holds the exact rules.

## Drift findings

All drift findings are warnings. Lervo reports them and never writes a document in response.

- `document_role_target_missing`: a declared optional layout role has no file.
- `markdown_link_target_missing`: a relative Markdown link in a current document names a missing path.
- `entrypoint_reference_missing`: user-owned prose in the root `README.md`, `AGENTS.md`, or `CLAUDE.md` names a missing path, or a `path: Symbol` whose file no longer contains the symbol.
- `document_stale`: the [ADR-0023](../../decisions/knowledge/documents/0023-evidence-based-document-staleness.md) evaluator proves a document stale. It compares the snapshot at the document's verified revision with HEAD, using connected paths inferred from the document's own references.
- `document_staleness_unknown`: documents whose evidence is unknown. They are counted, never treated as current.

Each finding carries only relative paths and reason names. Each code is bounded to 64 findings, and ordering is deterministic. Up to four findings also appear as agent-owned, non-blocking operating-attention items. They never gate terminal lifecycle status. The lint result's `documentStaleness` field reports coverage: `observed` or `unavailable`, plus evaluated, current, stale, unknown, and unevaluated counts.

## Staleness projection

The background knowledge pass records `.lervo/state/knowledge/document-staleness.json`. Foreground lint only reads it, and it can be rebuilt from Git history. It lists stale and unknown documents with their verified revision, reasons, connected paths, and changed paths. Later update planning consumes this list. That planning, which turns stale documents into evidence-bound update candidates, is out of scope here.

## Historical documents

A document under `docs/archive/` or under an `archive` capacity override is historical. So is a document with historical front matter or a leading `Historical`, `Archived`, or `Superseded` blockquote banner.

Structural publication lists historical documents in a separate "Historical documents (not current design)" group and labels each entry. Default knowledge retrieval excludes them. A query that names history (`archive`, `archived`, `historical`, `history`, `legacy`, `superseded`, `obsolete`, `deprecated`) includes them, and each such hit has `historical: true`. Drift checks skip historical documents.

## Layout role templates

Lervo's product-document role templates (`product_vision`, `system_architecture`, `execution_specification`, `delivery_roadmap`) are seeded only where their path or an alias exists. The layout migration prunes an unmodified template that has no file. It re-adds a template only when it moves a recognized document there. Both changes are one Lervo-managed update to `.lervo/knowledge/document-layout.yaml`.
