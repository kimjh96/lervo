# Delegation and activation

The runtime requires the reviewed event-writer version 4 transition and an exact project delegation. Default writers remain unchanged. Reader support must precede production activation. Without valid delegation, discovery reports `waiting_authority` and invokes no provider or document writer.

Delegation at `.lervo/knowledge/convergence-delegation.json` has a version 1 contract pinning:

- Project and active parent ancestry.
- Generator/reviewer/writer/integrator role versions and hashes.
- Capabilities, provider choices, canonical and normalization roots, and meaningful verification suites.
- Integration ref, repository identity, expiry, resource ceilings, and an existing reviewer's exact plan hash.

Optional asset dispositions bind exact path/hash, kind, rationale, and a pinned verification suite. Generated output cannot create these permissions. See [Asset manifest authority](asset-manifest-authority.md) for sidecar binding and application.

## Host-local and tracked authority

Parent and reviewer ancestry is local to the repository host. When `HEAD` does not track the authority file, source replication between hosts with separate workforce records must not exchange it. Project initialization ignores its exact path in `.lervo/.gitignore`; each host applies its own reviewed grant. The local grant remains authoritative: a peer's unrelated agent identity or expired grant cannot replace it through host-local seeding or term adoption.

Under [ADR-0478](../../../../decisions/coordination/sync/0478-renew-each-delegation-with-one-writer.md), a delegation tracked by `HEAD` is shared repository content. Its exact worktree bytes enter replica snapshots, and apply, merge, and rollback reproduce them. Only the convergence owner renews or rebinds it; a `replica_follower` writes nothing and receives the owner's bytes through replication. Replication does not bypass runtime project, ancestry, role, suite, review, or expiry checks. An untracked delegation remains host-local and survives replica cleanup. Renewals are neither committed nor published; removing a tracked grant from the index requires ordinary review.

## Ownership and continuity

A host-local grant authorizes convergence on that host; the [cross-host owner lease](cross-host-ownership.md) separately selects the converging host. Under a host continuity policy, the convergence owner's resident renews the grant at the same scope. Any resident seeds a missing grant from a peer host's exchanged scope, binding it to a local accountable agent; see [fleet continuity](continuity.md).

A renewal retains `review.reviewedAt` from the last owner review and derives `expiresAt` from the previous expiry ([ADR-0478](../../../../decisions/coordination/sync/0478-renew-each-delegation-with-one-writer.md)). The asset disposition sidecar and canonical repository documents remain ordinary repository sources.
