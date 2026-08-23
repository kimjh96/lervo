# ADR-0024: Provider-neutral project verification and result artifacts

Status: `accepted`
Decision date: 2026-08-19

## Context

Provider command telemetry cannot prove required project verification. Lervo must bind required commands, repository snapshot, actual execution/skip status, and preserved output. One growing manifest/log creates contention, while shell strings lose argument boundaries.

## Decision

### Sharded suites

- Store one suite at `.lervo/verifications/<suiteId>.yaml`. Init creates only an empty directory and no default command or passing result.
- Safely load one requested file up to 64 KiB and validate filename/ID/schema/semantics. Never execute symlinks, unstable reads, invalid IDs, or unknown entries.
- A suite contains at most 32 ordered commands, each with ID, executable, argument array, relative cwd, timeout, combined output limit, and environment-variable names.
- Pass only executable-search `PATH`/`Path` and explicitly named variables. Spawn executable/arguments directly, never a shell.
- v0 fixes `stopOnFailure=true`; after first failure mark remaining commands `not_run`.

### Execution and artifacts

- `@lervo/verification-contract` owns canonical suite/result hashes and execution-free semantics. Provider-independent `@lervo/verification` executes them.
- Before execution, prove root and cwd are real in-repository directories without symlink escape. Recheck requested revision immediately before and after all commands through the same snapshot port.
- Kill processes on timeout, cancellation, or output overflow and never promote them to success.
- Store each command's stdout/stderr as separate CAS artifacts. Result metadata contains only artifact coordinates.
- Bind `VerificationResult` to suite ID/hash, repository snapshot hash, total time/status, and ordered command digest/status/exit/time/failure reason. Store canonical result JSON in CAS and verify read-back.
- Derive verification ID from canonical result content excluding ID.

Overall states are `passed` (every command ran and exited 0), `failed` (nonzero, timeout, overflow, or execution error), and `cancelled`. Command states distinguish `passed`, `failed`, `timed_out`, `output_limit_exceeded`, `execution_error`, `cancelled`, and `not_run`. Semantic validation recomputes all state, order, digest, exit, time, artifact, and ID relationships.

This initial slice created no verification events or managed-run connection. Artifact existence alone proves neither run completion, writing publication, nor knowledge verification. ADR-0032 later defines orchestration and event order.

### Privacy and failures

Command definitions remain only in local suite source; metadata/events contain no command or arguments. Output remains local CAS. Store neither allowed environment names nor values in results. Hub transfer requires separate policy.

| Code | Meaning |
| --- | --- |
| `invalid_verification_suite`, `verification_suite_not_found`, `verification_layout_invalid` | Invalid, missing, or unsafe suite; start no command. |
| `invalid_verification_request`, `command_working_directory_invalid` | Invalid execution coordinates or unsafe root/cwd. |
| `repository_snapshot_failed`, `repository_snapshot_mismatch` | Cannot safely match requested pre-run state; start no command. |
| `repository_changed_during_verification` | State changed during commands; create no normal result artifact. |
| `artifact_storage_failed` | Output/result CAS write or read-back failed. |
| `result_contract_invalid` | Result semantics disagree with suite/evidence; expose no terminal status. |

Nonzero exit, timeout, overflow, execution error, and cancellation are explicit result states, not raw exception messages.

## Consequences

- Codex and Claude share one project verifier independent of provider command telemetry.
- Failure, skip, and cancellation remain distinct from success.
- Results bind suite and snapshot while raw logs remain outside events.
- ADR-0025 adds writing publication; later deliberation uses both result contracts.
