# Run evidence and validation

The source digest includes associated run events. Actual startup and verification events invalidate previously observed task state before a terminal run event arrives.

`run.requested` proves dispatch; `adapter.started` proves provider startup. Neither proves progress or acceptance. A completed run requires its result CAS bytes and every referenced verification result, with matching hashes, schemas, and event coordinates. Each loaded result is limited to 1 MiB.

A failed run remains uncertain unless the narrow no-tool failure proof in [assignment recovery](../assignment-recovery.md) is satisfied. A missing or conflicting stop remains uncertain. Read-only sandbox configuration alone does not prove a no-tool session.

## Failure diagnostics

Failure diagnostics preserve the complete code, phase, and retryability ledger in CAS under `run.failed.diagnosticDigest`. The artifact excludes raw errors, prompts, paths, commands, results, and credentials, and is limited to 64 entries and 16 KiB. The writer reads back exact bytes before relying on storage.

Storage failure remains a failed run with an unavailable diagnostic, not a safely retryable result. Older digest-only failures remain readable and uncertain. Owner context exposes exact available worker diagnostics; owner-reasoning failures do not change their own task basis.

## Validation boundary

Tests exercise the built CLI with a protocol fixture provider, real SQLite journals, and a Git worker workspace. They verify managed changes in the worker, unchanged control files, duplicate-decision suppression, canonical result/verification loading, and an outstanding artifact-review decision. This evidence does not constitute production provider or installed Discord acceptance.
