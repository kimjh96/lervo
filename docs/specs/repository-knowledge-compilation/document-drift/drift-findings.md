# Drift Findings and Staleness Projection

## Drift findings

All drift findings are warnings. Lervo reports them and never writes a document in response.

- `document_role_target_missing`: a declared optional layout role has no file.
- `markdown_link_target_missing`: a relative Markdown link in a current document names a missing path.
- `entrypoint_reference_missing`: user-owned prose in the root `README.md`, `AGENTS.md`, or `CLAUDE.md` names a missing path, or a `path: Symbol` whose file no longer contains the symbol.
- `document_stale`: the [ADR-0023](../../../decisions/knowledge/documents/0023-evidence-based-document-staleness.md) evaluator proves a document stale by comparing its verified-revision snapshot with HEAD, using connected paths inferred from the document's own references.
- `document_staleness_unknown`: a document's evidence is unknown. These documents are counted and never treated as current.

Each finding carries only relative paths and reason names. Each code is limited to 64 findings, with deterministic ordering. Up to four findings also appear as agent-owned, non-blocking operating-attention items; they never gate terminal lifecycle status.

The lint result's `documentStaleness` field reports coverage (`observed` or `unavailable`) and evaluated, current, stale, unknown, and unevaluated counts.

## Staleness projection

The background knowledge pass records `.lervo/state/knowledge/document-staleness.json`. Foreground lint only reads it; it can be rebuilt from Git history.

The projection lists stale and unknown documents with their verified revision, reasons, connected paths, and changed paths. Later update planning consumes this list to turn stale documents into evidence-bound update candidates. That planning is out of scope here.
