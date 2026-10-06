# Fleet continuity

- [ ] Background knowledge stays current on every repository and host without per-repository setup or periodic owner action under [ADR-0469](../../../../../decisions/coordination/sync/0469-keep-background-knowledge-continuous-on-every-host.md).

Implemented and source-tested. Tests cover:

- Policy contract, renewal window, horizon cap, revocation, and limit refusal.
- Standing-policy adoption from a reviewed delegation, with same-scope renewal and an event.
- Two simulated hosts exchanging host records through a fake Hub, seeding the peer's delegation, and electing one owner and one waiting host.
- A newly initialized repository reaching an active delegation, Hub mode, publication settings, and a lease on its first reconciliation.
- A resident seeding and waiting for the holder on its first cycle.
- Owner-host derivation: probing before Hub mode, legacy migration, leaving operator files untouched, and coordinate changes.
- The `sync.write` implication over HTTP and unchanged refusal for other principals.
- Upgrade `background_owned`, the doctor, attention projection, and Node hand-off of Hub coordinates.

## Open installed acceptance

- Mac and WSL adopt the policy; every registered repository reports an active delegation on both hosts.
- A delegation renews inside its window on an installed host without owner input.
- plen and digimon run in Hub mode with one owner.
- `lervo upgrade` reports `current (background_owned)` on a delegated repository with normalization debt.
