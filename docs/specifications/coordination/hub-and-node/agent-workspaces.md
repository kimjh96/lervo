# Agent workspace coordination

## Mode and authority

Agent workspace coordination is a separate optional Hub surface. Local execution defaults to `local_first`, using the repository-instance scheduler without Hub access. A repository may explicitly select `hub_coordinated` for assignments spanning multiple Nodes; connectivity never changes the mode implicitly.

Separate `workspace.read` and `workspace.coordinate` permissions govern this surface. Hub storage and audit exclude local paths, branch names, source or patch bodies, prompts, provider output, credentials, approval grants, and cleanup commands. A reservation is scheduler evidence only; it grants no repository write, merge, provider, approval, deployment, or cleanup authority.

## Reservations

Before a local claim in coordinated mode, a Node requests a reservation binding project and repository identity, normalized path-scope digests, assignment and workspace IDs, Node ID, generation, base commit, integration-target digest, bounded expiry, and idempotency. Exact and ancestor scopes conflict. The Node acquires its local lease only after obtaining the reservation and releases the reservation if the local claim fails. Renewal fences stale generations.

Reservation loss before claim blocks startup. Expiry after claim freezes new managed writes and automatic integration while preserving the local worktree for higher-generation recovery. Hub unavailability has no execution effect in `local_first`. Only the Node may integrate or remove a worktree, through exact local plans.

V1 reservations inherit local workforce bounds: at most 128 normalized scopes and leases from 5 seconds through 30 minutes. A Hub reservation cannot expire after its local lease. Immutable policy `workspace-coordination-v1` permits 32 active reservations and 128 current terminal summaries per destination/project/repository coordinate. Terminal summaries expire after 30 days. Reaching a limit rejects new coordination and never evicts an active reservation.

## State and reconciliation

Hub current state is `pending`, `granted`, `released`, or `expired`; only `granted` is claimable. Every committed state change has one append-only audit transition. Workspace summaries accept only monotonic generations and lifecycle transitions and remain observational. Out-of-order, unknown-parent, or invalid transitions fail closed.

Assignment evaluation distinguishes `disabled`, `ready`, `unavailable`, `conflicted`, and `stale_generation`. Node runtime reconciliation independently reports `disabled`, `pending`, `ready`, or `unavailable` with a bounded failure code.

The Node derives summaries from canonical repository-instance lifecycle events, reads the authenticated Hub current set, skips exact or newer remote observations, and publishes missing transitions in local event order. A missing provisioning parent, stale generation, altered content hash, unverified Hub identity, or transport failure stops reconciliation without changing local lifecycle state. Summaries are observational projections; only local events remain repository authority.

Workspace reservations and repository workstream replication retain distinct identities, permissions, and failure meanings. Reservation order cannot select a divergent workstream head; workstream head selection cannot override a scope conflict.

See the [planned agent workspace specification](../../execution/agent-workspaces.md).
