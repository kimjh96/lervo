# Responsibility claim transition

`SupervisionResponsibilityClaimer` installs a responsibility at the exact revision produced by an assignment claim. The proposed revision must equal the observed assignment revision plus one. Role coordinates, acceptance criteria, verification suites, paths, and predecessor contract must match the actual source. A live lease blocks replacement. Claiming does not start a provider.

## Recording and recovery

The adapter snapshots caller input, verifies the expected assignment hash and canonical causes, and stores the task in CAS. The existing assignment lock remains held while a recorder verifies the resulting lease, revision, and unchanged assignment bytes.

A single fenced event-store transaction appends `assignment.claimed` and `work.responsibility.bound`. The binding includes the claim event as a cause. Recorder failure rolls back both events and restores the exact previous assignment bytes. CAS artifacts may remain unreferenced after failure.

This is not a cross-filesystem/database crash transaction. Process termination after the assignment write but before event commit can leave an unbound lease for recovery to inspect. A missing binding must not imply safe replay, release the lease, or grant a successor. An exact recorded replay returns its existing assignment and binding without another claim. Changed revisions or lease coordinates require reconciliation.

## Node session authority

`NodeSupervisionSession.claimResponsibility` adds current mandate authority before and after the adapter's transition admission, the canonical owner as reviewer, mandate deadline limits, current workstream causes, and the existing owner fence. Its callback must validate the actual effect's permission and task sources; storage fencing alone is not operating-policy admission.

The composition rejects escaped sessions and changed owner authority, including changes after the assignment write.

An expired responsibility with a prepared workspace may acquire a successor lease only when canonical admission, the exact preparation receipt, and every matching managed decision prove that execution never started. Within five seconds, the live Git observation must still match the original marker, base commit, native instance, and unchanged checkout. Partial run events, changed files, active writers, or mismatched records block recovery. The previous checkout remains intact; only a new workspace bound to the successor lease can execute. The owner receives a bounded workspace identity and evidence hash without host paths. Newly proven recovery invalidates an older attention basis without deleting its history.

## Validation and remaining work

Tests cover resulting-revision binding, exact replay, source-scope changes, live leases, authority loss on both sides of the claim, transaction rollback, lost owner fences, old writers, and caller mutation.

The complete production effect adapter, interrupted-claim inspection, lease renewal/revision reconciliation, planning, and production activation remain delivery work.
