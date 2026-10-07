# Drift Findings and Staleness Projection

## Drift findings

All drift findings are warnings. Lervo reports them and never writes a document in response.

- `document_role_target_missing`: a declared optional, user-owned layout role has no file at its path or legacy aliases. Excludes Lervo-owned roles and unmodified Lervo templates; required roles still fail as `document_role_conflict`.
- `markdown_link_target_missing`: a relative Markdown link in a current document names a missing path.
- `entrypoint_reference_missing`: user-owned prose in root `README.md`, `AGENTS.md`, or `CLAUDE.md` names a missing path, or a `path: Symbol` whose file no longer contains the symbol.
- `document_stale`: the [ADR-0023](../../../decisions/knowledge/documents/0023-evidence-based-document-staleness.md) evaluator proves a document stale by comparing its verified-revision snapshot with HEAD, using connected paths inferred from the document's own references.
- `document_staleness_unknown`: a document's evidence is unknown. These documents are counted and never treated as current.

Each finding carries only relative paths and reason names. Each code is limited to 64 findings in deterministic order.

Terminal lifecycle inspection derives at most four items from its lint call and returns them as advisories, separate from lifecycle issues. Advisories never change terminal lifecycle status or block a Stop, worker checkpoint, or turn declaration.

Operating attention also projects drift findings as agent-owned, non-blocking items in `lervo application attention` and the cached prompt-path projection, within the twelve-item, 4 KiB terminal attention budget.

The lint result's `documentStaleness` field reports coverage (`observed` or `unavailable`) and evaluated, current, stale, unknown, and unevaluated counts.

## Staleness projection

Repository knowledge currency, run by the background knowledge pass and lifecycle verification, uses `evaluate_and_record` to write the rebuildable projection `.lervo/state/knowledge/document-staleness.json`. Foreground lint evaluates staleness read-only and reuses matching projections. During transaction-plan validation, lint skips staleness because stage checks compare errors only.

The projection key covers evaluator version, HEAD, UTC day, the document path and content-hash set, and normalization outputs. The projection can be rebuilt from Git history.

The projection lists stale and unknown documents with their verified revision, reasons, connected paths, and changed paths. Later update planning consumes this list to turn stale documents into evidence-bound update candidates. Consumers must compare its `currentRevision` with the revision they act on. Update planning is out of scope here.
