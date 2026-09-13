# Managed execution identity

The managed CLI accepts an explicit SHA-256 execution key. The provider-neutral identity function binds the key to the canonical project ID and derives stable run and session IDs. Reusing a key identifies the same attempt: callers must inspect its canonical evidence rather than authorize another provider turn. Changing the key neither authorizes a retry nor establishes retry ancestry.

Keyed execution requires reviewed writer version 3. Before grounding, search preparation, or any provider call, the CLI records `managed.execution.reserved` in the event-store transaction. Its payload contains only the execution key and request hash. A second connection or reopened process cannot reserve the same key, even if the first process stopped before `run.requested`.

Causal admission rejects an already requested run before provider startup. The telemetry transaction checks bounded run history before inserting the causal/request batch; conflicting or over-bound history fails closed.

The CLI accepts request text through `--stdin` without a positional request, capped at 128 KiB. Repeated `--path` arguments preserve every explicit write target through the existing managed multi-file execution boundary. `--provider-executable` passes an absolute configured path to the primary provider adapter; it does not pin auxiliary search, grounding, canary, or writing-evaluation providers.

## Recovery boundary

Reservation prevents repeated invocation under one key; it neither establishes the outcome of a crashed prelude nor authorizes a new key. A recovered decision without `run.requested` remains uncertain. A spawned CLI process is not provider-start evidence. Startup, progress, verification, acceptance, and delivery each require their respective canonical records.

The explicit Node factory can compose the [managed worker adapter](managed-execution/worker.md) with configured Node and CLI paths. Production startup activation and installed Discord acceptance remain open. The application must still provide grounded planning and current task-derived admission, including budget evidence.

Canonical owner controls compose [artifact review](managed-execution/artifact-review.md), [goal completion](managed-execution/goal-completion.md), and [accepted-result delivery](result-delivery.md) with actual task admission. Configured [native owner reasoning](owner-reasoning.md) uses separate provider reservations and read-only managed execution before proposing those effects.

The native owner also derives [separate workspace preparation and dispatch](workspace-preparation.md) from the canonical responsibility. Host configuration pins the parent directory, base commit, and integration target.

[Assignment recovery](managed-execution/assignment-recovery.md) preserves rejected results and binds successor leases, isolated workspace generations and versioned retry causality.
