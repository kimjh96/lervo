# Canonical responsibility claims

`SupervisedResponsibilityClaimV1` defines one `work.responsibility_claim.v1` effect with seven required fields: `schemaVersion`, `kind`, `responsibility`, `expectedAssignmentHash`, `provider`, `leaseDurationMs` and `rationaleArtifactHash`. The exact canonical artifact binds predecessor assignment bytes, resulting responsibility revision, selected executor, native provider and lease duration. Leases last five seconds to thirty minutes and cannot exceed the responsibility or mandate deadline.

Initial bindings use `allocate_existing`; bindings with a predecessor use `revise_responsibility`. Neither adds a worker, assignment or provider attempt. A one-token internal reservation bounds the decision without claiming a provider invocation or usage measurement. Current mandate admission still checks capacity, observed aggregate usage, action scope and deadlines.

## Admission and transition

The default Node reader requires the active canonical workstream and graph, exact assignment hash, current responsibility predecessor and an available qualified executor. It checks role versions and hashes, ancestry, provider compatibility, capability and path ceilings, and overlapping live leases. An unresolved live lease blocks revision. Acceptance criteria, verification suite or assignment scope changes require a separate assignment transition; claims cannot widen the assignment contract.

The built-in effect adapter verifies its immutable admitted decision and combined authority/task digest, then passes deterministic session identity and decision causation to the existing fenced responsibility claimer. Before and after assignment mutation, it rechecks other assignment bytes, agent bytes, role evidence, workstream bytes, event head and current owner authority. The claimer records `assignment.claimed` and `work.responsibility.bound` together. Existing durable rollback restores the predecessor if event recording or authority validation fails.

## Evidence and recovery

Existing event schemas retain assignment, role, lease and causal coordinates; responsibility prose and rationale remain in CAS artifacts. No new event type or secret-bearing field is introduced. The receipt inspector binds the exact policy decision, request identity, responsibility artifact and adjacent claim/binding events. Historical confirmation proves lease acquisition; current lease validity and provider start require separate observations.

An absent binding with unchanged predecessor bytes means not started. Missing assignment bytes, partial evidence or conflicting coordinates remain uncertain. Changed-source claim supersession is not yet connected. Confirmed effects release their internal reservation; provider dispatch requires actual worker readiness and a separate decision.

The canonical Node fixture verifies topology creation, responsibility acquisition, recovery without another lease and a subsequent dispatch request. Lower-level fixtures verify rollback when owner authority disappears during either transition observation. These fixtures do not prove automated model planning, scoped cross-team transfer or installed journeys.

## Native revision of unstarted work

The native owner can map `revise_responsibility` details to this same exact claim. It observes the existing responsibility, rejects a live or terminal lease, compares actual qualified staff and may select an available child instead of the owner. The binding preserves the predecessor hash and increments the durable lease generation. An expired lease on an already reopened retry may be revised when observation proves the current responsibility has no dispatch or terminal effect. Its historical recovery coordinate and unchanged acceptance and verification remain binding; this revision does not create another retry or erase prior usage.

Before ordinary revision, canonical admission requires no earlier managed attempt and no workspace record for the assignment. The effect rechecks those workspace coordinates while committing the claim. Previously executed work uses the separate [assignment recovery](managed-execution/assignment-recovery.md) contract. Claims cannot change acceptance criteria, required verification or the bound role. Criteria and verification changes use a separate [assignment amendment](assignment-amendments.md); bound role changes retain their versioned role transition.

The native mapper fixture verifies expired-lease reassignment to an existing qualified child, unchanged owner accountability and rejection of live leases. A distinct amendment fixture changes acceptance before acquiring successor duties, covers receipt failure and restart, and invokes real staffing probes and the fenced claim without a worker call.

For one reservation-only managed retry, the native owner may reclaim the same expired, unstarted duty without another model turn. It requires the canonical version-five absence inspection, an unchanged exact responsibility binding, no dispatch or terminal event, the same qualified executor selected by fresh workforce planning, and the same acceptance and verification IDs. The deadlines advance by their original bounded offsets from lease acquisition; the new claim remains within mandate expiry and maximum deadline. More than one reservation-only supersession for the reopened attempt, a changed binding, partial run, missing proof or unavailable executor falls back to ordinary owner judgement. This transition uses the existing claim effect and event schemas and does not reset token usage or create a worker attempt.
