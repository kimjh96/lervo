# `assignment.lease.widened`

In Lervo ADE coordination, a conversation's lease grows path by path as its agent writes. Schema 16 adds this event, which records one growth of the lease. Schemas 1 through 15 reject the type. `assignment.lease.renewed` keeps meaning a moved expiry only.

The coordination specification is `docs/specifications/execution/product-surfaces/ade-coordination.md` ("Event schema 16"), proposed on the `ade-coordination-spec` branch at revision 719a7e2c1.

## Fields

All nine fields are required, and no other key is kept: the payload screen drops any other field before validation.

- `assignmentId`: the conversation's assignment, `asn_` and 24 hex digits.
- `agentId`: the agent that holds the lease, `agt_` and 24 hex digits.
- `leaseGeneration`: the lease's generation, an integer of at least 1, as `generation` in `assignment.claimed`.
- `revision`: the assignment's revision after the widening, an integer of at least 1.
- `expectedPathDigest`: the digest `assignment.claimed` uses, `sha256:` and 64 hex digits over the lease's sorted path set after the widening.
- `expectedPathCount`: how many entries the lease holds after the widening, 1 to 10,000.
- `addedPathCount`: how many entries this widening added, 1 to 10,000.
- `cause`: `claim` when a write claimed the paths, or `reconcile` when the turn's end claimed paths that changed without a claim.
- `occurredAt`: when the lease widened.

## Envelope

The workforce transition that widens the lease records the event in the repository's store, as it records `assignment.claimed`, and the transition does not commit without it ([ADR-0205](../../../../../decisions/execution/orchestration/0205-conflict-safe-repository-agent-workforce.md)). The envelope has `schemaVersion: 16`.

It carries no path, tool input, command text, or file content: the path set appears only as its digest and its counts. Readers ship first: no release records the event yet, and the writer target stays below 16.

## Failure meaning

- The writer records the event only at schema 16 or later. Below 16, the coordination stage does not run, so a lease cannot widen.
- Each event is final for its widening. A later widening is a new event with a higher `revision`.
- A `cause` outside the two above is refused rather than kept as an open string, so a new cause needs a new reader first.
- A payload outside this closed shape is refused, and the envelope refuses the type below schema 16.
