# Versioned amendments of unstarted assignments

`SupervisedAssignmentAmendmentV1` maps `revise_responsibility` to `work.assignment_amendment.v1`. Seven fields are required: `schemaVersion`, `kind`, `responsibility`, `expectedAssignmentHash`, `predecessorBindingHash`, `provider` and `rationaleArtifactHash`. The responsibility defines the post-amendment revision and a separate successor claim.

Current mandate admission bounds the action, role, capability and path ceiling, deadline, capacity and observed aggregate budget. No further human review is required within that installed authority.

## Scope and transition

The native owner may change acceptance criteria and verification suites for an unstarted assignment. Paths may narrow within predecessor scope. Widening paths or changing the bound role requires the corresponding separately authorized topology or role transition.

A live lease, terminal status, recovery coordinate, returned result, handoff, previous managed attempt or any workspace record blocks the amendment. Failed retrieval or missing staff readiness cannot establish capacity.

Canonical admission verifies exact predecessor bytes, the current responsibility binding, workstream and graph, original acceptance owner and selected executor availability. The scheduler-locked transition clears an expired lease while preserving its generation, replaces explicitly amended fields and increments the assignment revision.

The assignment stores one current `amendment` coordinate containing predecessor assignment and responsibility hashes and the exact proposed successor responsibility hash. Earlier bytes and duties remain in CAS and canonical events.

A separate claim must bind that exact successor responsibility, obtain the next lease generation and record the new binding. Amendment alone neither transfers acceptance ownership nor starts a worker. An ordinary claim cannot substitute revised acceptance without this explicit transition.

## Evidence and failures

`assignment.amended` uses event envelope version 3. Six payload fields are required: `assignmentId`, `assignmentRevision`, `assignmentHash`, `predecessorAssignmentHash`, `predecessorResponsibilityHash` and `successorResponsibilityHash`.

Task prose, verification commands, repository paths, model output and credentials remain outside event payloads. Exact contract and rationale artifacts use the governed CAS boundary.

Before recording the event, the Node rechecks assignment and roster bytes, workspace coordinates, workstream, event head, deadline, mandate and owner fence. Failure restores predecessor bytes. A missing event with unchanged predecessor state is not started; conflicting state or an incomplete receipt remains uncertain.

After a recorded uncertain observation, only this reversible exact transition may be retried, following fresh source validation. Recovery starts no provider and does not replay a model decision.

Workforce tests cover criteria and verification replacement, narrowed scope, exact successor claim, stale or live-lease rejection, and event-failure rollback. The native planning fixture uses real staffing probes and canonical owner-fenced transitions, including amendment receipt failure, runtime restart and the next exact claim. Controlled model decisions in these fixtures do not prove external-model quality or installed journey completion.
