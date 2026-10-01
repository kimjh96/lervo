# Failure diagnostics

Failure diagnostics preserve the complete code, phase, and retryability ledger in CAS under `run.failed.diagnosticDigest`. The artifact excludes raw errors, prompts, paths, commands, results, and credentials and is limited to 64 entries and 16 KiB. The writer reads back exact bytes before relying on storage.

When a provider adapter supplies a bounded transport diagnostic, the artifact also records:

- Provider.
- Normalized operation: `session_initialize`, `session_start`, `context_inject`, `capability_status`, `turn_start`, `turn_interrupt`, `session_stop`, or `other`.
- Failure kind: `server_rejected`, `response_timeout`, `process_exited`, `process_unavailable`, or `invalid_message`.
- A signed 32-bit numeric server code or null.

The field never records a server message or data object. Missing or malformed adapter diagnostics are omitted, not guessed. `run.failed.failureCode` still describes the managed-run failure; retryability remains unchanged. A server rejection code alone never authorizes retry or proves a model was unavailable.

Storage failure remains a failed run with an unavailable diagnostic, not a safely retryable result. Older digest-only failures remain readable and uncertain. Owner context exposes exact available worker diagnostics; owner-reasoning failures do not change their own task basis.

## Supervision failure observation

The failure ledger accepts the required bounded `code`, `phase`, and `retryable` fields and optional bounded `providerTurnFailureCode`, `causeCode`, and structured `providerDiagnostic`; unknown keys remain invalid. The diagnostic must agree with the canonical `run.failed` terminal and exact CAS digest. A missing artifact or contradictory terminal remains uncertain.

`known_safe_failure` requires one settled read-only adapter session whose tool calls, command execution, and file changes were all unsupported. The stop must belong to the same terminal; every diagnostic entry must name an allowed no-tool provider or result phase and code; and no tool, command, file, capability, or unmanaged-change event may appear. A read-only configuration or provider failure code alone cannot prove this. Abandoned turns remain uncertain under their separate proof boundary.
