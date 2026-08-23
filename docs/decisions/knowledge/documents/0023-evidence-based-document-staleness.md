# ADR-0023: Evidence-based document staleness

Status: `accepted`
Decision date: 2026-08-19

## Context

A different repository revision does not itself prove that a document is stale, while a current file listing can miss files changed and later deleted. Unknown evidence cannot be reported as current. Staleness is rebuildable derived data and remains separate from mutation and approval.

## Decision

`@lervo/documents` provides pure `evaluateDocumentStaleness`, accepting a valid manifest, evaluation time, current snapshot, optional exact verified-revision snapshot, and optional managed-input observations. Snapshots contain only a revision and relative-path content hashes.

Return one schema-valid `DocumentStalenessResult` per document, containing document/result IDs, time, verified/current revisions, overall status, and per-signal statuses and reasons. Derive the result ID from canonical result content excluding that ID.

- `current`: every applicable signal proves current.
- `stale`: at least one signal proves change or expiry, even if others are unknown.
- `unknown`: no signal proves staleness, but at least one is unavailable.

Signal rules:

- `reviewInterval`: stale exactly at `verifiedAt + reviewIntervalDays`.
- `documentPath`: at the verified revision, presence is current and absence is stale. At another revision, compare the document hash only against a snapshot that exactly matches the verified revision; otherwise return unknown.
- `connectedPaths`: compare each path and its descendants across both snapshots. No observations on both sides means unknown, not unchanged. `src` does not match `src2`.
- `managedInputs`: for `managed_blocks` and `lervo_generated`, compare declared source IDs and hashes. Changed or explicitly absent input is stale; unavailable observation is unknown. This signal does not apply to user-owned documents.

Reject inconsistent same-revision snapshots, undeclared or duplicate observations, unsafe paths, and invalid times. The evaluator writes no file, CAS object, or event and claims no modification, approval, or completed verification.

Results contain only local relative paths and source IDs—never bodies, input source, absolute paths, or secrets. This slice emits no `document.stale.detected`; a future event requires a separate allowlist and failure meaning.

- `invalid_staleness_request`: inputs do not form consistent evidence; collect them again.
- `staleness_contract_invalid`: computed output violates the public schema; report no status.

## Consequences

Revision differences are not exaggerated into staleness, and missing evidence remains visible. `AGENTS.md`, `CLAUDE.md`, and `README.md` use the same contract. Snapshot collection, persistence, and CLI presentation remain outside the evaluator.
