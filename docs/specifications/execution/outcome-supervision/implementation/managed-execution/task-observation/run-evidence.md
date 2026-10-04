# Run evidence and validation

The source digest includes associated run events. Actual startup and verification events invalidate previously observed task state before a terminal run event arrives.

`run.requested` proves dispatch; `adapter.started` proves provider startup. Neither proves progress or acceptance. A completed run requires its result CAS bytes and every referenced verification result, with matching hashes, schemas, and event coordinates. Each loaded result is limited to 1 MiB.

A failed run remains uncertain unless the narrow no-tool failure proof in [assignment recovery](../assignment-recovery.md) is satisfied. A missing or conflicting stop remains uncertain. Read-only sandbox configuration alone does not prove a no-tool session.

- [Failure diagnostics](run-evidence/failure-diagnostics.md): diagnostic storage, privacy, and failure semantics.
- [Validation boundary](run-evidence/validation-boundary.md): tested behavior and acceptance limits.
