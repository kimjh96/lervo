# Failure diagnostics

Failure diagnostics preserve the complete `code`, `phase`, and retryability ledger in CAS under `run.failed.diagnosticDigest`. The artifact is limited to 64 entries and 16 KiB. It excludes raw errors, prompts, paths, commands, results, and credentials. The writer reads back exact bytes before relying on storage.

When a provider adapter supplies a bounded transport diagnostic, the artifact also records:

- Provider.
- Normalized operation: `session_initialize`, `session_start`, `context_inject`, `capability_status`, `turn_start`, `turn_interrupt`, `session_stop`, or `other`.
- Failure kind: `server_rejected`, `response_timeout`, `process_exited`, `process_unavailable`, or `invalid_message`.
- Signed 32-bit numeric server code or null.

This field never records a server message or data object. Missing or malformed adapter diagnostics are omitted, never guessed. `run.failed.failureCode` still describes the managed-run failure; retryability is unchanged. A server rejection code alone never authorizes retry or proves model unavailability.

Storage failure leaves a failed run with an unavailable diagnostic, not a safely retryable result. Older digest-only failures remain readable and uncertain. Owner context exposes exact available worker diagnostics; owner-reasoning failures do not change their own task basis.

## Supervision failure observation

`packages/orchestrator/src/provider-run-failures.ts` translates bounded adapter turn codes into managed failure codes. Failure details preserve the adapter's `providerTurnFailureCode`, a separate bounded cause code, and structured `providerDiagnostic`. The managed failure code and phase remain authoritative for retryability; an adapter diagnostic or server code alone cannot authorize another turn.

`apps/node-runtime/src/supervision-failure-observation.ts` accepts only the optional diagnostic keys below. Classifying a failed supervised run requires an exact canonical terminal and CAS diagnostic. Repeatability depends on settled no-tool evidence, not the provider's failure description.

The failure ledger requires bounded `code`, `phase`, and `retryable` fields. It accepts optional bounded `providerTurnFailureCode`, `causeCode`, and structured `providerDiagnostic`; unknown keys are invalid. The diagnostic must agree with the canonical `run.failed` terminal and exact CAS digest. A missing artifact or contradictory terminal remains uncertain.

`known_safe_failure` requires all of the following:

- One settled read-only adapter session in which tool calls, command execution, and file changes were all unsupported.
- A stop belonging to the same terminal.
- Every diagnostic entry naming an allowed no-tool provider or result phase and code.
- No tool, command, file, capability, or unmanaged-change event.

A read-only configuration or provider failure code alone cannot prove `known_safe_failure`. Abandoned turns remain uncertain under their separate proof boundary.
