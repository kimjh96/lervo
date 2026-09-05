# Workforce State

Repository workforce state uses durable role and agent identity, bounded parent depth, assignments, dependency and path scopes, short scheduler locks, renewable generation-bound leases, exact evidence handoffs, and CAS finalization. Same-role and mixed-role agents run concurrently only on disjoint scopes. Root agents and subagents use identical transitions.

`assignment.lease.renewed` retains only assignment, agent, lease, generation, and expiry; it excludes task prose, paths, prompts, output, reasoning, and credentials. Missing or rejected renewal leaves the prior lease authoritative until recorded expiry.
