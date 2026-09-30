# Authority and state

Repository state, workstreams, assignments, leases, events, verification, and artifacts remain canonical. Assignment graphs, topology history, operating goals, governed decisions, operating boards, threads, inboxes, observed budgets, operating liveness, acknowledgments, agent context, organization reports, and product activity pages are rebuildable projections.

Products may cache presentation state but must not make it assignment, topology, approval, completion, delivery, acknowledgment, liveness, context, or verification authority.

An `available` route may still reject missing roles, workstreams, assignments, leases, approvals, verification, resources, or repository state. Products must preserve its exit status and typed result, never converting an unavailable or invalid result into an empty success.

External connector effects remain unavailable in the stock CLI. Hosts injecting a connector must meet the separate descriptor, credential, destination, artifact, writing-permit, durable-reservation, unknown-effect, and common-conformance contracts.
