# Assignment recovery and successor execution

Recovery preserves assignment identity and the original acceptance, verification and path ceiling. The native owner proposes bounded rework; canonical admission checks actual current review and completion evidence before reopening.

`SupervisedAssignmentRecoveryV1` contains `schemaVersion`, `kind`, `responsibility`, `recovery`, `provider` and `rationaleArtifactHash`. The recovery coordinate binds the predecessor assignment artifact, prior responsibility hash, terminal run and event, rejected review event, next attempt ordinal and prior lease generation. The successor responsibility addresses the rejection and binds the revision after a separate claim.

A returned result rejected by independent writing judgement may still have a leased assignment. Rejected writing must not be recorded as successful completion. `SupervisedAssignmentRecoveryV2` adds the exact `settledLeaseId` to the six V1 fields and supports rework or a separately proven safe retry. Admission requires:

- The matching current leased revision and generation.
- A reconciled completed run with the exact recorded rejection, or the safe-failure proof.
- A workspace with no registered writer.

Reopening clears that settled lease. Expiry, a stopped process or a bare rejection event is insufficient evidence.

A worker permission failure before any provider start needs no recovery transition. The recorded decision retains its lease and reservation-free state; [`work.supervision.readiness.failed`](../readiness.md#permission-failure-evidence-and-recovery) records the safe non-start, and the same decision resumes after repair. Only an expired lease enters the unstarted-responsibility revision path.

The detailed contracts are:

- [Durable transitions and failure proofs](assignment-recovery/durable-transition.md).
- [Workspace and attempt lineage](assignment-recovery/workspace-and-attempt-lineage.md).
- [Events, privacy and regression acceptance](assignment-recovery/events-and-validation.md).
- [Abandoned turns](assignment-recovery/abandoned-turns.md), governed by [ADR-0407](../../../../../decisions/execution/orchestration/governed-work/0407-settle-invocation-fenced-abandoned-turns.md).
