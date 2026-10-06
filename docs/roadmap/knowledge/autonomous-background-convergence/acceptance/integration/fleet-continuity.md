# Fleet continuity

- [ ] Background knowledge stays current on every repository and host without per-repository setup or periodic owner action under [ADR-0469](../../../../../decisions/coordination/sync/0469-keep-background-knowledge-continuous-on-every-host.md).

Implemented and source-tested. Tests cover:

- Policy contract, renewal window, horizon cap, revocation, and limit refusal.
- Standing-policy adoption from a reviewed delegation, with renewal at the same scope and an event.
- Two simulated hosts that exchange host records through a fake Hub, seed the peer's delegation, and elect one owner and one waiting host.
- A newly initialized repository that reaches an active delegation, Hub mode, publication settings, and a lease on its first reconciliation.
- A resident whose first cycle seeds and waits for the holder.
- Owner-host derivation: probe before Hub mode, legacy migration, operator files untouched, and coordinate changes.
- The `sync.write` implication over HTTP and the unchanged refusal for other principals.
- Upgrade `background_owned`, the doctor, attention projection, and Node hand-off of Hub coordinates.

## Open installed acceptance

- Mac and WSL adopt the policy, and every registered repository reports an active delegation on both hosts.
- A delegation renews inside its window on an installed host without owner input.
- plen and digimon run in Hub mode with one owner.
- `lervo upgrade` reports `current (background_owned)` on a delegated repository with normalization debt.
