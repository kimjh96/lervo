# Failure diagnostics

Failure diagnostics preserve the complete code, phase, and retryability ledger in CAS under `run.failed.diagnosticDigest`. The artifact excludes raw errors, prompts, paths, commands, results, and credentials and is limited to 64 entries and 16 KiB. The writer reads back exact bytes before relying on storage.

When a provider adapter supplies a bounded transport diagnostic, the artifact also records:

- Provider.
- Normalized operation: `session_initialize`, `session_start`, `context_inject`, `capability_status`, `turn_start`, `turn_interrupt`, `session_stop`, or `other`.
- Failure kind: `server_rejected`, `response_timeout`, `process_exited`, `process_unavailable`, or `invalid_message`.
- A signed 32-bit numeric server code or null.

The field never records a server message or data object. Missing or malformed adapter diagnostics are omitted, not guessed. `run.failed.failureCode` still describes the managed-run failure; retryability remains unchanged. A server rejection code alone never authorizes retry or proves a model was unavailable.

Storage failure remains a failed run with an unavailable diagnostic, not a safely retryable result. Older digest-only failures remain readable and uncertain. Owner context exposes exact available worker diagnostics; owner-reasoning failures do not change their own task basis.
