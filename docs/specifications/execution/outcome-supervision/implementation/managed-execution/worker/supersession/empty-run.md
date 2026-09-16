# Empty-run supersession

An exact managed run with no events may be superseded after its deadline expires or its canonical source changes. The adapter first validates the admitted decision and CAS effect. Under the current serialized owner lease, it rechecks the source, mandate, event head, and empty run before recording `work.supervision.decision.superseded`.

A late CLI must pass its original owner-token fence and the pending-decision check before reservation. The [shared supersession contract](../supersession.md) defines lease, history, and partial-run recovery boundaries.

## Absence evidence

The CAS absence envelope has `schemaVersion: 4`, `kind: work.effect_absence`, and thirteen required fields:

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

For `deadline_expired`, observation time must be at or after the plan deadline. The envelope must contain no owner token, paths, request prose, provider output, or credentials.

The existing supersession event retains payload version 1 and references this exact envelope. Historical replay validates its coordinates; a missing, altered, or incompatible envelope blocks recovery. Readers must support the envelope before its writer is activated.

## Validation

Native contract fixtures cover empty and partial runs, lost ownership, reopened journal inspection, and rejection of late invocation after supersession.
