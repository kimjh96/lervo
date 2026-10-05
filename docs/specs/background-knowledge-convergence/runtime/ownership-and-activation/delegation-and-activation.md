# Delegation and activation

The runtime requires the reviewed event-writer version 4 transition and an exact project delegation. Default writers remain unchanged. Reader support must precede production activation. Without valid delegation, discovery reports `waiting_authority` and invokes no provider or document writer.

Delegation lives at `.lervo/knowledge/convergence-delegation.json`. Its version 1 contract pins:

- Project and active parent ancestry.
- Generator/reviewer/writer/integrator role versions and hashes.
- Capabilities, provider choices, canonical and normalization roots, and meaningful verification suites.
- Integration ref, repository identity, expiry, resource ceilings, and an existing reviewer's exact plan hash.

Optional asset dispositions bind exact path/hash, kind, rationale, and a pinned verification suite. Generated output cannot create these permissions. See [Asset manifest authority](asset-manifest-authority.md) for sidecar binding and application.

Parent and reviewer ancestry is local to the repository host. Source replication between hosts with separate workforce records must not exchange the authority file. Project initialization ignores its exact path in `.lervo/.gitignore`; each host applies its own reviewed grant. The grant remains authoritative locally without allowing a peer's unrelated agent identity or expired grant to replace it. A host-local grant authorizes convergence on that host; which host actually converges is decided separately by the [cross-host owner lease](cross-host-ownership.md). The asset disposition sidecar and canonical repository documents remain ordinary repository sources.
