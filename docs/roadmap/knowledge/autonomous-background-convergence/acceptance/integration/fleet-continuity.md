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

- [ ] No resident skips a checkout silently, `lervo upgrade` activates event schema 4, and every host runs one managed host resident service under [ADR-0470](../../../../../decisions/operations/services/0470-admit-every-knowledge-resident-and-run-one-host-resident-service.md).

Implemented and source-tested, with [ADR-0471](../../../../../decisions/coordination/sync/0471-keep-cross-host-knowledge-ownership-safe-when-hub-coordination-fails.md) ownership safety: upgrade event writer stage (local-only activation with backup, stale hook reader, unreachable Hub, stale approval), host resident hold and automatic activation, Node child hold and resume, host lock and status, host service install, upgrade, and blockers, the doctor's `event_schema_outdated` and `continuity_pending` findings, unproven Hub coordinates that stay read-only, project-credential candidates, the continuity timer under admission, and identity-preserving rebind.

- [ ] A host that lacks a delegation-bound suite, repository role, or asset manifest installs the exact reviewed bytes another host shared through the Hub and seeds under [ADR-0477](../../../../../decisions/coordination/sync/0477-carry-delegation-bound-definitions-across-hosts.md).

Implemented and source-tested: binding-reproducing contract validation and size bound; content-addressed Hub storage with refresh and pruning; HTTP publish, list, and read under `sync.write` with project scope; two simulated hosts where the peer lacks an untracked suite, installs it, seeds the same scope, and waits for the owner; user-owned conflict, forged content, and older-Hub cases; repository role installation; and managed replacement.

## Open installed acceptance

- On the Mac, `lervo upgrade --apply` activates schema 4 for axli, plen, shiflo, and digimon, installs `com.lervo.knowledge.host`, and the doctor shows each served.
- Mac and WSL adopt the policy; every registered repository reports an active delegation on both hosts.
- A delegation renews inside its window on an installed host without owner input.
- plen and digimon run in Hub mode with one owner.
- `lervo upgrade` reports `current (background_owned)` on a delegated repository with normalization debt.
- On the Mac, axli installs `.lervo/verifications/repository.knowledge.yaml` from the WSL delegation's shared definition, reports an active delegation, and observes `waiting_owner` while WSL holds the lease.
