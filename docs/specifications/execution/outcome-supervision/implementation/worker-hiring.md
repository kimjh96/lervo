# Scoped worker hiring

The native owner may propose `hire_worker` with exactly a display name and a bounded task requirement. The task uses allocation's role, deliverable, acceptance, path, capability, verification, and deadline fields. It remains planning evidence: its placeholder assignment ID is never installed as an assignment or responsibility binding.

Grounded planning reads current repository context, role contracts, staff, ancestry, live leases, and the configured native provider environment. An available qualified worker or owner prevents absence-based hiring. Unobserved staff or an unavailable provider environment blocks the proposal. A fully observed skill or capacity gap permits separate mandate review; it does not create an employee.

## Proposal and admission

`work.worker_hire.v1` is a version-1 owner proposal with `schemaVersion`, `kind: work.worker_hire`, `requirement`, `displayName`, `provider`, `expectedAgentsHash`, and `rationaleArtifactHash`. Admission binds one additional worker, zero assignments, no provider attempt, the exact role and path requirements, and the current roster hash. Normal mandate limits apply.

The concrete Node adapter reobserves the staffing gap and actual executable/login profile before admission and execution. Through the workforce store, it registers one named child of the current owner with exactly the requirement paths and inherited capability-package authority. The requested role must already be installed and allowed. Before commit, it rechecks parent state, delegation depth, duplicate name, role hash, capacity, concurrent assignments, current workstream, mandate, deadlines, and event head.

## Recording and recovery

The workforce recorder appends `agent.registered` and `organization.agent.membership.changed` together under the owner fence. The child belongs to the same exact repository team. Hiring creates no Discord identity, channel, external deployment, or assignment. A failed fenced event transaction restores the preceding workforce bytes. Both events retain their existing privacy rules. The effect adds no event type; task prose and staffing rationale remain in governed CAS.

Deterministic registered and membership event IDs bind the preceding admitted decision. Recovery checks those events against the actual child identity, parent, role, provider, path scope, and membership. An unchanged roster with neither event proves no hire. A changed roster or partial evidence remains uncertain and never triggers a blind duplicate hire.

## Validation and subsequent decisions

Focused tests cover a real scoped child and team membership, recovery through a fresh storage connection, rejection when existing staff are available, and owner-fence loss that rolls back the child. Allocation and dispatch require separate decisions and fresh worker readiness after hiring.
