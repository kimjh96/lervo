# Prepared workspace without dispatch

Budget or readiness admission can reject a managed dispatch before its decision is recorded. A prepared workspace whose task lease later expires may be retained only when the complete bounded supervision history contains no admitted managed decision for that exact responsibility and lease. The managed CLI requires an exact current recorded decision before reservation or provider startup; process absence alone does not prove this condition.

## Read-only observation

The read-only observer validates the original admitted workspace preparation, its policy decision, receipt, CAS artifacts, lease generation, and host coordinates. Any matching dispatch decision requires existing verified supersession proof; a live, partial, or inconsistent dispatch remains blocking.

Retention is also blocked by:

- missing preparation evidence
- a live task lease
- a registered writer
- a changed checkout
- recovery state
- a changed event head

The observer reads the event head before inspecting history and rechecks it after rereading the canonical workspace and native checkout within five seconds.

## Evidence and authority boundaries

For the no-decision case, the local evidence digest binds `kind: unrecorded_dispatch`, `workspacePreparationPlanHash`, and `workspacePreparationEventHash`. These are required digest inputs, not a new persistent event or authority record. The digest binds the immutable preparation receipt, so unrelated events between complete observations do not change an otherwise identical proof. An event-head change during any one observation still rejects it.

Digest inputs contain no paths, provider content, owner token, or credentials. The returned workspace proof grants no authority to write, remove, or execute. Later claim and worker admission must independently recheck the current mandate, owner fence, responsibility, lease, and workspace. Deploy readers that recognize this proof before relying on it for successor execution.

## Validation

Regression coverage verifies an untouched expired checkout with no dispatch decision, rejects live leases and missing receipts, preserves user changes, and rejects a canonical event arriving during inspection. Existing empty-run and reservation-only tests continue to reject partial runs, lost owner fences, and late invocation.
