# Fleet continuity

The following contracts are implemented and source-tested; installed acceptance remains open.

## Standing policy and first reconciliation

- [ ] Background knowledge stays current on every repository and host without per-repository setup or periodic owner action under [ADR-0469](../../../../../decisions/coordination/sync/0469-keep-background-knowledge-continuous-on-every-host.md).

Source tests cover:

- Policy contract, renewal window, horizon cap, revocation, and limit refusal.
- Standing-policy adoption from a reviewed delegation, same-scope renewal, and an event.
- Two simulated hosts exchanging host records through a fake Hub, seeding the peer's delegation, and electing one owner and one waiting host.
- A newly initialized repository reaching an active delegation, Hub mode, publication settings, and a lease on its first reconciliation.
- A resident seeding and waiting for the holder on its first cycle.
- Owner-host derivation: probing before Hub mode, legacy migration, leaving operator files untouched, and coordinate changes.
- The `sync.write` implication over HTTP and unchanged refusal for other principals.
- Upgrade `background_owned`, the doctor, attention projection, and Node hand-off of Hub coordinates.

## Resident admission and ownership safety

- [ ] No resident silently skips a checkout, `lervo upgrade` activates event schema 4, and every host runs one managed host resident service under [ADR-0470](../../../../../decisions/operations/services/0470-admit-every-knowledge-resident-and-run-one-host-resident-service.md).

Source tests include [ADR-0471](../../../../../decisions/coordination/sync/0471-keep-cross-host-knowledge-ownership-safe-when-hub-coordination-fails.md) ownership safety and cover:

- Upgrade event writer stage: local-only activation with backup, stale hook reader, unreachable Hub, and stale approval.
- Host resident hold and automatic activation; Node child hold and resume.
- Host lock and status; host service install, upgrade, and blockers.
- Doctor findings `event_schema_outdated` and `continuity_pending`.
- Unproven Hub coordinates remaining read-only and project-credential candidates.
- Continuity timer under admission and identity-preserving rebind.

## Shared delegation definitions

- [ ] A host lacking a delegation-bound suite, repository role, or asset manifest installs the exact reviewed bytes another host shared through the Hub and seeds under [ADR-0477](../../../../../decisions/coordination/sync/0477-carry-delegation-bound-definitions-across-hosts.md).

Source tests cover:

- Binding-reproducing contract validation and size bound.
- Content-addressed Hub storage with refresh and pruning.
- HTTP publish, list, and read under `sync.write` with project scope.
- Two simulated hosts: the peer lacks an untracked suite, installs it, seeds the same scope, and waits for the owner.
- User-owned conflict, forged content, and older-Hub cases.
- Repository role installation and managed replacement.

## Single-writer renewal

- [ ] Exactly one host writes each delegation renewal. Tracked replica followers receive the owner's exact bytes; eligible untracked followers adopt the owner's term while preserving local accountable identities. No replica apply, merge, rollback, or upgrade discards a renewed delegation under [ADR-0478](../../../../../decisions/coordination/sync/0478-renew-each-delegation-with-one-writer.md).

Source tests cover:

- Equal renewal bytes at any instant inside one window and on the term lattice after a lapse.
- Two simulated hosts: only the owner renews; the due follower writes nothing, retries in 15 minutes, then adopts the owner's term with identical bytes.
- A tracked delegation left to the replica by the follower, which renews to the previous owner's exact bytes after takeover with every grant lapsed.
- Replica apply and a coordinator pull-then-merge cycle carrying and keeping the owner's tracked-delegation renewal.
- `lervo upgrade --apply` with `knowledge_materialization` leaving a renewed tracked delegation unchanged.

## Replica runtime consistency

- [ ] A replica whose sides capture under different semantics fails with a named failure instead of reporting `current`. A delegation-only owner change reaches the follower once both sides match, under [ADR-0483](../../../../../decisions/coordination/sync/0483-run-replica-commands-through-one-current-runtime.md).

Source tests cover:

- A legacy-version peer failing the cycle at `protocol` without moving the common base or follower's bytes; a current peer then pulling the owner's delegation-only change.
- The `capture-version` command.
- SSH adapter mapping of a current answer, legacy usage error, SSH transport failure, and malformed answer.
- The atomic `current` runtime pointer.
- The `replica_service` upgrade stage moving the pointer and replacing a hand-written coordinator definition with one that runs through it.
- Exact coordinator configuration keys.
- Automatic migration of legacy `~/.lervo` configuration with a backup.

## Open installed acceptance

- [ ] On the Mac, `lervo upgrade --apply` activates schema 4 for axli, plen, shiflo, and digimon, installs `com.lervo.knowledge.host`, and the doctor shows each served.
- [ ] Mac and WSL adopt the policy; every registered repository reports an active delegation on both hosts.
- [ ] A delegation renews inside its window on an installed host without owner input.
- [ ] plen and digimon run in Hub mode with one owner.
- [ ] `lervo upgrade` reports `current (background_owned)` on a delegated repository with normalization debt.
- [ ] In plen, after both hosts run the ADR-0478 bundles, only the owner renews. Mac and WSL delegation files are byte-identical after the next replica cycle and after a later `lervo upgrade --apply`.
- [ ] After only `lervo upgrade` on both hosts, the Mac coordinator configuration has migrated to `peer.remoteRuntimesDirectory`, the Mac replica service runs through `current`, the plen cycle pulls the WSL owner's delegation, and both files hash equally. The next deploy needs no configuration or plist edit.
- [ ] On the Mac, axli installs `.lervo/verifications/repository.knowledge.yaml` from the WSL delegation's shared definition, reports an active delegation, and observes `waiting_owner` while WSL holds the lease.
