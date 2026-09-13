# Managed run supersession

## Empty-run supersession

An exact managed run with no events may be superseded after its deadline expires or its canonical source changes. The adapter first validates the admitted decision and CAS effect. Under the current serialized owner lease, it rechecks the source, mandate, event head, and empty run before recording `work.supervision.decision.superseded`.

A late CLI must pass its original owner-token fence and the pending-decision check before reservation. Supersession grants no execution or task lease. Version four requires an empty run. Version five admits only the reservation-only case described below. Other partial runs remain uncertain unless the separate [pre-turn host-reset recovery](../assignment-recovery.md) records an exact fenced failed terminal.

The CAS absence envelope has `schemaVersion: 4`, `kind: work.effect_absence`, and these thirteen required fields:

- schema version
- kind
- effect contract
- decision ID
- plan hash
- effect hash
- source revision digest
- deterministic run ID
- deterministic session ID
- `runEventsAbsent: true`
- event-head hash
- observation time
- `invalidatedBy`, set to `source_changed` or `deadline_expired`

For `deadline_expired`, the observation time must be at or after the plan deadline. The envelope must contain no owner token, paths, request prose, provider output, or credentials.

The existing supersession event retains payload version 1 and references this exact envelope. Historical replay validates its coordinates; a missing, altered, or incompatible envelope blocks recovery. Readers must support the envelope before its writer is activated.

Supersession preserves the assignment, responsibility, checkout, old lease, and resource history. Before another attempt, the owner must obtain a current responsibility and lease through a separately admitted recovery decision.

Native contract fixtures cover empty and partial runs, lost ownership, reopened journal inspection, and rejection of late invocation after supersession.

## Reservation-only supersession

A version-five absence envelope may retain exactly one canonical `managed.execution.reserved` event and no other event for the deterministic run. It preserves the thirteen version-four coordinates, sets `schemaVersion: 5` and `runEventsAbsent: false`, and requires `reservationEventId` and `reservationEventHash`.

The reservation must match the deterministic event, run, session, project, schema-three system actor, execution key, and bounded request hash. Its bytes remain canonical. No reservation, assignment, workspace, or observed usage is deleted.

Before supersession, recheck:

- the current owner fence
- changed source or expired plan
- the current mandate
- the unchanged event head
- the exact sole-reservation event set

The managed lifecycle records `run.requested` before any provider startup. A late worker must pass its original owner-token fence and current decision check before starting a provider. Any additional run event, including a late request, invalidates historical absence and prevents the reservation exemption. Process exit alone is insufficient.

Readers validate both the envelope and the current canonical event set. Only verified supersession releases the unstarted reservation from admission; observed provider usage remains cumulative. An altered event, absent envelope, incompatible version, lost owner fence, or partial lifecycle remains blocking. Deploy compatible readers before recording version-five evidence.

## Prepared workspace without dispatch

Budget or readiness admission can reject a managed dispatch before its decision is recorded. A prepared workspace whose task lease later expires may be retained only when the complete bounded supervision history contains no admitted managed decision for that exact responsibility and lease. The managed CLI requires an exact current recorded decision before reservation or provider startup; process absence alone does not prove this condition.

The read-only observer validates the original admitted workspace preparation, its policy decision, receipt, CAS artifacts, lease generation, and host coordinates. Any matching dispatch decision requires existing verified supersession proof; a live, partial, or inconsistent dispatch remains blocking.

Retention is also blocked by:

- missing preparation evidence
- a live task lease
- a registered writer
- a changed checkout
- recovery state
- a changed event head

The observer reads the event head before inspecting history and rechecks it after rereading the canonical workspace and native checkout within five seconds.

For the no-decision case, the local evidence digest binds `kind: unrecorded_dispatch`, `workspacePreparationPlanHash`, and `workspacePreparationEventHash`. These are required digest inputs, not a new persistent event or authority record. The digest binds the immutable preparation receipt, so unrelated events between complete observations do not change an otherwise identical proof. An event-head change during any one observation still rejects it.

The digest inputs contain no paths, provider content, owner token, or credentials. The returned workspace proof grants no authority to write, remove, or execute. Later claim and worker admission must independently recheck the current mandate, owner fence, responsibility, lease, and workspace. Deploy readers that recognize this proof before relying on it for successor execution.

Regression coverage verifies an untouched expired checkout with no dispatch decision, rejects live leases and missing receipts, preserves user changes, and rejects a canonical event arriving during inspection. Existing empty-run and reservation-only tests continue to reject partial runs, lost owner fences, and late invocation.
