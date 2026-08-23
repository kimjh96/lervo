# ADR-0024: Provider-neutral project verification and result artifacts

Status: `accepted`  
Decision date: 2026-08-19

## Context

Provider command telemetry cannot prove required project verification. Lervo must bind required commands, repository snapshot, actual execution or skip status, and preserved output. A single growing manifest or log creates contention, while shell strings lose argument boundaries.

## Decision

### Sharded suites

- Store each suite at `.lervo/verifications/<suiteId>.yaml`. Initialization creates only an empty directory, with no default command or passing result.
- Safely load one requested file of at most 64 KiB and validate its filename, ID, schema, and semantics. Never execute symlinks, unstable reads, invalid IDs, or unknown entries.
- A suite contains at most 32 ordered commands. Each specifies an ID, executable, argument array, relative cwd, timeout, combined-output limit, and environment-variable names.
- Pass only executable-search `PATH`/`Path` and explicitly named variables. Spawn executables and arguments directly, never through a shell.
- v0 fixes `stopOnFailure=true`; after the first failure, mark remaining commands `not_run`.

### Execution and artifacts

- `@lervo/verification-contract` owns canonical suite/result hashes and execution-free semantics. Provider-independent `@lervo/verification` executes suites.
- Before execution, prove root and cwd are real in-repository directories without symlink escape. Recheck the requested revision immediately before and after all commands through the same snapshot port.
- Kill processes on timeout, cancellation, or output overflow; never promote them to success.
- Store each command's stdout and stderr as separate CAS artifacts. Result metadata contains only artifact coordinates.
- Bind `VerificationResult` to suite ID/hash, repository snapshot hash, total time/status, and each ordered command's digest, status, exit, time, and failure reason. Store canonical result JSON in CAS and verify read-back.
- Derive the verification ID from canonical result content excluding the ID.

Overall states are `passed` when every command ran and exited 0, `failed` for nonzero exit, timeout, overflow, or execution error, and `cancelled`. Command states are `passed`, `failed`, `timed_out`, `output_limit_exceeded`, `execution_error`, `cancelled`, and `not_run`. Semantic validation recomputes every state, order, digest, exit, time, artifact, and ID relationship.

This initial slice creates no verification events or managed-run connection. Artifact existence alone proves neither run completion, writing publication, nor knowledge verification. ADR-0032 later defines orchestration and event order.

### Privacy and failures

Command definitions remain only in local suite sources; metadata and events contain no command or arguments. Output remains in local CAS. Results store neither allowed environment names nor values. Hub transfer requires separate policy.

| Code | Meaning |
| --- | --- |
| `invalid_verification_suite`, `verification_suite_not_found`, `verification_layout_invalid` | Suite is invalid, missing, or unsafe; start no command. |
| `invalid_verification_request`, `command_working_directory_invalid` | Execution coordinates or root/cwd are invalid or unsafe. |
| `repository_snapshot_failed`, `repository_snapshot_mismatch` | Requested pre-run state cannot be safely matched; start no command. |
| `repository_changed_during_verification` | State changed during commands; create no normal result artifact. |
| `artifact_storage_failed` | Output/result CAS write or read-back failed. |
| `result_contract_invalid` | Result semantics conflict with suite or evidence; expose no terminal status. |

Nonzero exit, timeout, overflow, execution error, and cancellation are explicit result states, not raw exception messages.

## Consequences

- Codex and Claude use one provider-independent verifier.
- Failure, skip, and cancellation remain distinct from success.
- Results bind suite and snapshot while raw logs remain outside events.
- ADR-0025 adds writing publication; later deliberation uses both result contracts.
