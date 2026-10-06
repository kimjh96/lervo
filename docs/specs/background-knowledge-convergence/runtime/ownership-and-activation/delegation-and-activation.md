# Delegation and activation

The runtime requires the reviewed event-writer version 4 transition and an exact project delegation. Default writers remain unchanged. Reader support must precede production activation. Without valid delegation, discovery reports `waiting_authority` and invokes no provider or document writer.

Delegation resides at `.lervo/knowledge/convergence-delegation.json`. Its version 1 contract pins:

- Project and active parent ancestry.
- Generator/reviewer/writer/integrator role versions and hashes.
- Capabilities, provider choices, canonical and normalization roots, and meaningful verification suites.
- Integration ref, repository identity, expiry, resource ceilings, and an existing reviewer's exact plan hash.

Optional asset dispositions bind exact path/hash, kind, rationale, and a pinned verification suite. Generated output cannot create these permissions. See [Asset manifest authority](asset-manifest-authority.md) for sidecar binding and application.

Parent and reviewer ancestry is local to the repository host. Source replication between hosts with separate workforce records must not exchange the authority file. Project initialization ignores its exact path in `.lervo/.gitignore`; each host applies its own reviewed grant. The local grant remains authoritative: a peer's unrelated agent identity or expired grant cannot replace it.

A host-local grant authorizes convergence on that host; the [cross-host owner lease](cross-host-ownership.md) separately decides which host converges. Under a host continuity policy, the resident renews the grant at the same scope and seeds a missing grant from a peer host's exchanged scope, binding it to a local accountable agent; see [fleet continuity](continuity.md). The asset disposition sidecar and canonical repository documents remain ordinary repository sources.
