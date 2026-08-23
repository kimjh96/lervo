# ADR-0023: Evidence-based document staleness

Status: `accepted`
Decision date: 2026-08-19

## Context

A different repository revision does not by itself prove a document stale, while a current file listing can miss files changed and later deleted. Unknown evidence must not be reported current. Staleness is rebuildable derived data and must remain separate from document mutation or approval.

## Decision

`@lervo/documents` provides pure `evaluateDocumentStaleness`, accepting a valid manifest, evaluation time, current snapshot, optional exact verified-revision snapshot, and optional managed-input observations. Snapshots contain only revision and relative-path content hashes.

Return one schema-valid `DocumentStalenessResult` per document with document/result IDs, time, verified/current revisions, overall status, and per-signal statuses/reasons. Derive result ID from canonical result content excluding the ID.

- `current`: every applicable signal proves current.
- `stale`: at least one signal proves change/expiry, even when others are unknown.
- `unknown`: no stale proof but at least one signal is unavailable.

Signal rules:

- `reviewInterval`: stale exactly at `verifiedAt + reviewIntervalDays`.
- `documentPath`: at the verified revision, present is current and absent stale. At another revision, compare document hash only with a snapshot exactly matching the verified revision; otherwise unknown.
- `connectedPaths`: compare each path and descendants across both snapshots. No observations on both sides is unknown, not unchanged. `src` does not match `src2`.
- `managedInputs`: compare declared source IDs/hashes for `managed_blocks` and `lervo_generated`; changed or explicitly absent is stale, unavailable observation unknown. User-owned documents are not applicable.

Reject inconsistent same-revision snapshots, undeclared/duplicate observations, unsafe paths, and invalid times. The evaluator writes no file, CAS object, or event and claims no modification, approval, or completed verification.

Results contain local relative paths and source IDs only, never bodies, input source, absolute paths, or secrets. This slice emits no `document.stale.detected`; a future event requires a separate allowlist and failure meaning.

- `invalid_staleness_request`: inputs do not form consistent evidence; collect again.
- `staleness_contract_invalid`: computed output violates public schema; report no status.

## Consequences

Revision differences are not exaggerated into staleness, and missing evidence remains visible. `AGENTS.md`, `CLAUDE.md`, and `README.md` use the same contract. Snapshot collection, persistence, and CLI presentation remain outside the evaluator.
