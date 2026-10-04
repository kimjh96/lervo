# ADR-0456: Hand off repositories atomically with a writer lease

Status: `accepted`
Decision date: 2026-10-04
Amends: [ADR-0396](0396-conflict-safe-repository-replica-continuation.md), [ADR-0201](0201-repository-scoped-workstream-replication.md), [ADR-0404](0404-merge-divergent-repository-replicas.md)
Part of: [ADR-0452 open collaboration platform](../../foundation/0452-open-collaboration-by-default-with-authority-at-consequential-effects.md)

## Context

Code moves between the Mac and the WSL host through the replica coordinator (`apps/node-runtime/src/repository-replica-coordinator.ts`, `-git.ts`, `-merge.ts`, `-cli.ts`, `-ssh-peer.ts`, `-watch.ts`, and `packages/sync/src/repository-replication.ts`), driven by a Mac LaunchAgent. Workstream checkpoints move only through Nodes via the Hub (`packages/sync/src/workstream-replication.ts:111-234`, called solely from `sync-cycle-observer.ts`); the CLI offers `workstream current|start|update` and no publish or import. The two transports have no shared transaction, no shared owner, and no shared failure surface.

Verified defects:

- **Error fidelity.** `repository-replica-merge.ts:196-202` rewraps any non-Git error as "The repository replica merge could not be applied." and keeps the cause only in `{ cause }`; `repository-replica-cli.ts:186-190` prints `error.message` only. Snapshot, bundle, and apply failures lose their Git stderr the same way (`-git.ts:160-164,189-193,373-384`). The current workstream records replica merges for plen, flemo, and digimon failing since 2026-09-30 with no recorded cause.
- **Silent divergence.** The default `hold` policy returns a conflict, the coordinator maps it to `divergent`, and the only output is a stderr line each cycle with exit code 0 in watch mode. `repository_replica_divergent` is declared (`-coordinator.ts:90`) and never thrown. No event, health signal, attention item, or resolution command exists.
- **No version handshake.** Compatibility rests on implicit strings (snapshot `schemaVersion`, the `lervo-repository-replica-worktree-v1` envelope, the watch frame). Nothing compares runtime builds, and a running coordinator does not notice configuration changes.
- **Host-local files.** `.lervo/.gitignore` excludes `knowledge/convergence-delegation.json`, so `git add -A` normally respects it; the brief's hypothesis that the grant is swept in is mostly incorrect. The narrower gap is real: capture runs `read-tree HEAD` before `add -A` and has no explicit pathspec exclusion, so a repository whose `HEAD` predates the ignore rule, or whose `.lervo/.gitignore` lacks it, sweeps the grant in. Separately, `-merge.ts:38` resolves `.lervo/knowledge/` and `.lervo/generated/` conflicts to the Mac side silently.
- **Checkpoint conflicts.** `apps/node-runtime/src/workstream-replication.ts:41` throws a generic "import is blocked" and drops the blocker codes from `createReplicatedWorkstreamImportPlan`; the cycle rewraps it as `local_state_invalid`. ADR-0201 deferred reconciliation and it was never designed.
- **Parity is opt-in.** Replica readiness gates work only when `repositoryReplica.required` is configured; the installed deployments removed it. The coordinator always passes `allowHistoryReplacement: true`, so every push or pull runs `adopt`, which contradicts the roadmap rule that handoff "must not silently push, discard, merge, or overwrite".
- The replica subsystem emits no canonical events; `replicaDisposition` on `conversation.repository_work.completed` is the only trace.

## Decision

### One handoff primitive

`repository.handoff` moves, in one receipt, the exact source snapshot (ADR-0396's five coordinates and bundle), the current workstream head (ADR-0201's canonical snapshot JSON), and the **writer lease**. Direction is symmetric: `lervo repository handoff --to <peer>` and `lervo repository handback` run from either host; `lervo repository handoff status` shows the lease, parity, and last failure. The CLI gains the workstream publish and import steps the primitive needs; they are not separate user commands.

Apply order on the receiving side is source, then checkpoint, then lease, inside one coordinator transaction. Source apply failure rolls back under ADR-0396; checkpoint import failure leaves the source applied but the lease unchanged and records `repository.handoff.failed` with `stage: checkpoint`; the lease is written last so no host believes it is the writer before the bytes and checkpoint are present.

### Writer lease

Each repository has at most one writer host. The lease lives in `.lervo/state/repository-writer-lease.json` on both hosts, is mirrored to the Hub when one is configured, and is exchanged over the existing SSH peer transport otherwise, so local operation without a Hub is preserved. A lease has `holderHostHash`, `grantedAt`, and an optional `staleAfter`. It never expires silently: after `staleAfter` the Node reports `lease_stale` as an attention item and keeps refusing writes until a human or the principal proxy (ADR-0453, within its mandate) resolves it.

**Parity before work.** A Node whose repository lease is held elsewhere refuses mutating work with `repository_writer_lease_held_elsewhere`, answers the requester naming the holder and the one-line handoff command, and continues read-only work. When this Node holds the lease, replica readiness is required for mutating turns; the opt-in `repositoryReplica.required` flag is retired in favour of the lease. Repositories without a lease keep legacy behaviour and record `leaseDisposition: not_configured`.

### Divergence surfacing

A `hold` conflict emits `repository.replica.diverged` once per divergence identity (hash of both snapshot hashes), creates one operating-attention item with `actionOwner: user`, and, when the repository has a bound conversation, publishes one observation-only notice there. Repeated cycles over the same divergence add nothing. `lervo repository reconcile --prefer local|peer|merge` resolves it and emits `repository.replica.reconciled`. Health reports `degraded` while any divergence is open. `allowHistoryReplacement` is passed only by `reconcile` and `handoff`; ordinary cycles use fast-forward-only apply.

### Version handshake and configuration currency

Every cycle starts with `repository-replica protocol` on both sides exchanging `{ protocolVersion, snapshotSchemaVersion, envelopeVersion, runtimeBuildHash, configHash }`. A `protocolVersion` mismatch fails the cycle closed with `repository_replica_protocol_mismatch`; a build mismatch is recorded in the receipt and surfaced in `handoff status`. A changed `configHash` relative to the running coordinator's view yields `repository_replica_config_stale` and an attention item instructing a restart; the coordinator never continues on a configuration it did not load.

### Host-local exclusion and generated conflicts

Capture passes explicit pathspec exclusions, `:(exclude).lervo/knowledge/convergence-delegation.json`, `:(exclude).lervo/state`, and `:(exclude).lervo/data`, regardless of `.gitignore` or the `HEAD` ignore rules. Merge no longer resolves `.lervo/knowledge/` or `.lervo/generated/` conflicts to one side; it records them in the diverged event with `resolution: regenerate`, and `reconcile` regenerates those projections because they are rebuildable.

### Error fidelity

Every replica and handoff error carries `code`, `stage` (`protocol | snapshot | bundle | transfer | verify | apply | merge | checkpoint | lease | rollback`), `gitExitCode` when applicable, and a `stderrDigest` of at most 512 characters passed through the event-contract redaction. The CLI prints the cause chain; the receipt stores the last failure; watch mode logs each distinct failure once and then reports a counter.

### Checkpoint reconciliation

Workstream import surfaces the exact blocker code (`invalid_snapshot | identity_changed | origin_changed | non_advancing_revision | divergent_heads`) in health and attention. `lervo workstream reconcile --keep local|hub` creates a successor whose `origin` names both predecessor heads; ADR-0201's successor rule is extended so a reconciliation successor may replace two heads. No head is ever merged automatically.

## Events, states, and failure meaning

- `repository.handoff.completed`: `handoffId`, `repositoryIdentityHash`, `direction` (`to_peer | from_peer`), `sourceSnapshotHash`, `workstreamSnapshotHash` or null, `leaseHolderHostHash`, `previousHolderHostHash` or null, `protocolVersion`, `occurredAt`. Absent means the handoff did not complete.
- `repository.handoff.failed`: `handoffId`, `stage`, `failureCode`, `rolledBack` (boolean), `occurredAt`. `rolledBack: false` means the receiving repository requires inspection before any write.
- `repository.writer.lease.changed`: `repositoryIdentityHash`, `holderHostHash` or null, `previousHolderHostHash` or null, `reason` (`handoff | handback | manual_release | reconcile`), `staleAfter` or null, `occurredAt`.
- `repository.replica.diverged`: `replicaId`, `divergenceId`, `localSnapshotHash`, `peerSnapshotHash`, `commonSnapshotHash`, `conflictPathCount`, up to 16 `conflictPathDigests`, `occurredAt`. `repository.replica.reconciled`: `divergenceId`, `strategy`, `resultSnapshotHash`, `occurredAt`.
- New failure codes: `repository_replica_protocol_mismatch`, `repository_replica_config_stale`, `repository_writer_lease_held_elsewhere`, `repository_handoff_partial`, `lease_stale`.

Privacy: events carry hashes of hosts, snapshots, and paths, never paths, credentials, SSH destinations, or diff content. `stderrDigest` is redacted and stays in local logs and receipts, not in canonical events.

## Migration

1. Ship error fidelity, explicit exclusions, and divergence events first; they change no behaviour for healthy replicas.
2. Add the protocol handshake with the current versions; both hosts must run the same build before step 3.
3. Introduce the lease as `not_configured` by default; enable per repository with `lervo repository handoff init`, starting with the Lervo repository that was removed from replication.
4. Retire `repositoryReplica.required` after every configured repository has a lease.
5. Resolve the plen, flemo, and digimon backlog with `reconcile`, recording `reconciled` events as the acceptance baseline.

## Acceptance (installed)

- Mac to WSL handoff of the Lervo repository with an uncommitted edit and an advanced workstream; the Discord Node continues the workstream, changes bytes, and hands back; both hosts show identical snapshot hashes and one lease history.
- An injected two-sided edit produces exactly one `diverged` event, one attention item, one conversation notice, and resolves through `reconcile`.
- An injected protocol mismatch fails closed with its code; an injected Git failure shows its stderr digest in the CLI output and receipt.
- A Node without the lease refuses a mutating Discord request with a reply naming the holder, and still answers read-only requests.
- Seven days of fleet operation record no repeated identical failure beyond the once-per-identity rule.

## Deferred

Hub artifact transport for bundles, concurrent multi-writer repositories, and automatic merge policies beyond `hold` and `prefer` remain out of scope.

## References

- [ADR-0396](0396-conflict-safe-repository-replica-continuation.md)
- [ADR-0201](0201-repository-scoped-workstream-replication.md)
- [ADR-0415](0415-bounded-replica-transport-and-service-completion.md)
- [Mac-offline source handoff roadmap](../../../roadmap/product-outcome-convergence/host-products/discord/source-handoff.md)
- [Replica divergence and merge specification](../../../specifications/coordination/node-change-driven-work/repository-replicas/divergence-and-merge.md)
