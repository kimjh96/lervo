# Reservation-only supersession

A version-five absence envelope may retain exactly one canonical `managed.execution.reserved` event and no other event for the deterministic run. It preserves the thirteen [version-four coordinates](empty-run.md), sets `schemaVersion: 5` and `runEventsAbsent: false`, and requires `reservationEventId` and `reservationEventHash`.

The reservation must match the deterministic event, run, session, project, schema-three system actor, execution key, and bounded request hash. Its bytes remain canonical. No reservation, assignment, workspace, or observed usage is deleted. The [shared supersession contract](../supersession.md) also applies.

## Fencing and lifecycle

Before supersession, recheck:

- the current owner fence
- changed source or expired plan
- the current mandate
- the unchanged event head
- the exact sole-reservation event set

The managed lifecycle records `run.requested` before any provider startup. A late worker must pass its original owner-token fence and current decision check before starting a provider. Any additional run event, including a late request, invalidates historical absence and prevents the reservation exemption. Process exit alone is insufficient.

## Validation and admission

Readers validate both the envelope and the current canonical event set. Only verified supersession releases the unstarted reservation from admission; observed provider usage remains cumulative. An altered event, absent envelope, incompatible version, lost owner fence, or partial lifecycle remains blocking. Deploy compatible readers before recording version-five evidence.
