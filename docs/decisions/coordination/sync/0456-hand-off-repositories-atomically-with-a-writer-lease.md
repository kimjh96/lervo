# ADR-0456: Hand off repositories atomically with a writer lease

Status: `accepted`
Decision date: 2026-10-04
Amends: [ADR-0396](0396-conflict-safe-repository-replica-continuation.md), [ADR-0201](0201-repository-scoped-workstream-replication.md), [ADR-0404](0404-merge-divergent-repository-replicas.md)
Part of: [ADR-0452 open collaboration platform](../../foundation/0452-open-collaboration-by-default-with-authority-at-consequential-effects.md)
Amended by: [ADR-0468](0468-propagate-knowledge-supersession-across-replicated-checkouts.md) (supersession stage), [ADR-0478](0478-renew-each-delegation-with-one-writer.md) (tracked delegation replication), [ADR-0483](0483-run-replica-commands-through-one-current-runtime.md) (current runtime pointer, exact configuration, capture version handshake), [ADR-0561](../../foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md) (divergence and checkpoint reconciliation without the owner)

## Context

Code moves between Mac and WSL through a Mac LaunchAgent-driven replica coordinator: `apps/node-runtime/src/repository-replica-coordinator.ts`, `-git.ts`, `-merge.ts`, `-cli.ts`, `-ssh-peer.ts`, `-watch.ts`, and `packages/sync/src/repository-replication.ts`. Workstream checkpoints move only through Nodes via the Hub (`packages/sync/src/workstream-replication.ts:111-234`, called solely from `sync-cycle-observer.ts`). The CLI offers `workstream current|start|update`, without publish or import. These transports share no transaction, owner, or failure surface.

Verified defects:

- **Error fidelity:** `repository-replica-merge.ts:196-202` rewraps every non-Git error as "The repository replica merge could not be applied.", retaining the cause only in `{ cause }`; `repository-replica-cli.ts:186-190` prints only `error.message`. Snapshot, bundle, and apply failures lose Git stderr (`-git.ts:160-164,189-193,373-384`). The current workstream records plen, flemo, and digimon replica merge failures since 2026-09-30 without causes.
- **Silent divergence:** Default `hold` returns a conflict, mapped by the coordinator to `divergent`. Watch mode prints a stderr line each cycle and exits with code 0. `repository_replica_divergent` is declared (`-coordinator.ts:90`) but never thrown. No event, health signal, attention item, or resolution command exists.
- **No version handshake:** Compatibility relies on implicit snapshot `schemaVersion`, the `lervo-repository-replica-worktree-v1` envelope, and watch-frame strings. Runtime builds are not compared; running coordinators do not detect configuration changes.
- **Host-local files:** `.lervo/.gitignore` excludes `knowledge/convergence-delegation.json`, normally respected by `git add -A`; the brief's claim that the grant is swept in is mostly incorrect. Capture runs `read-tree HEAD` before `add -A` without explicit pathspec exclusions, so it can capture the grant when `HEAD` predates the ignore rule or `.lervo/.gitignore` lacks it. Separately, `-merge.ts:38` silently resolves `.lervo/knowledge/` and `.lervo/generated/` conflicts to the Mac side.
- **Checkpoint conflicts:** `apps/node-runtime/src/workstream-replication.ts:41` throws generic "import is blocked", dropping `createReplicatedWorkstreamImportPlan` blocker codes; the cycle rewraps it as `local_state_invalid`. ADR-0201 deferred reconciliation, which was never designed.
- **Opt-in parity:** Readiness gates apply only with `repositoryReplica.required`, which installed deployments removed. The coordinator always passes `allowHistoryReplacement: true`, making every push or pull run `adopt`, contrary to the roadmap requirement that handoff "must not silently push, discard, merge, or overwrite".
- **No canonical replica events:** The only subsystem trace is `replicaDisposition` on `conversation.repository_work.completed`.

## Decision

### One handoff primitive

`repository.handoff` moves three things in one receipt: the exact source snapshot (ADR-0396's five coordinates and bundle), the current workstream head (ADR-0201's canonical snapshot JSON), and the writer lease.

`lervo repository handoff --to <peer>` and `lervo repository handback` run symmetrically from either host. `lervo repository handoff status` shows the lease, parity, and last failure. The CLI gains workstream publish and import steps for this primitive, without separate user commands.

The receiver applies source, checkpoint, then lease within one coordinator transaction:

- Source apply failure rolls back under ADR-0396.
- Checkpoint import failure leaves source applied and lease unchanged, recording `repository.handoff.failed` with `stage: checkpoint`.
- The lease is written last, so neither host believes it is the writer before source bytes and checkpoint are present.

### Writer lease

Each repository has at most one writer host. Both hosts store the lease in `.lervo/state/repository-writer-lease.json`. The lease is mirrored to the Hub when configured; otherwise, the existing SSH peer transport exchanges it, preserving operation without a Hub.

A lease contains `holderHostHash`, `grantedAt`, and optional `staleAfter`. It never expires silently. After `staleAfter`, the Node reports `lease_stale` as an attention item and refuses writes until a human or principal proxy resolves it under ADR-0453 and within the proxy's mandate.

A Node whose lease is held elsewhere refuses mutating work with `repository_writer_lease_held_elsewhere`, replies with the holder and a one-line handoff command, and continues read-only work. A lease-holding Node requires replica readiness for mutating turns. The lease replaces the opt-in `repositoryReplica.required` flag. Repositories without a lease retain legacy behavior and record `leaseDisposition: not_configured`.

### Divergence surfacing

A conflict emits `repository.replica.diverged` once per divergence identity (the hash of both snapshot hashes), creates one operating-attention item, and posts one observation-only notice to the repository's bound conversation, if any. Repeated cycles over the same divergence add nothing.

As amended by ADR-0561, the coordinator resolves it in the same cycle: it saves the losing side to a backup branch, then prefers the configured side ([divergence and merge](../../../specifications/coordination/node-change-driven-work/repository-replicas/divergence-and-merge.md)). An unresolved divergence is Lervo debt, and `--prefer` is removed. Health remains `degraded` while any divergence is open. Only `reconcile` and `handoff` pass `allowHistoryReplacement`; ordinary cycles use fast-forward-only apply.

### Version handshake and configuration currency

Every cycle starts with `repository-replica protocol` on both sides, exchanging `{ protocolVersion, snapshotSchemaVersion, envelopeVersion, runtimeBuildHash, configHash }`.

- A `protocolVersion` mismatch fails the cycle closed with `repository_replica_protocol_mismatch`.
- A build mismatch is recorded in the receipt and shown in `handoff status`.
- A `configHash` change relative to the running coordinator's view produces `repository_replica_config_stale` and an attention item instructing a restart. The coordinator never continues with configuration it did not load.

### Host-local exclusion and generated conflicts

[ADR-0478](0478-renew-each-delegation-with-one-writer.md) and the current [divergence and merge specification](../../../specifications/coordination/node-change-driven-work/repository-replicas/divergence-and-merge.md) supersede the original unconditional exclusion of `.lervo/knowledge/convergence-delegation.json` and requirement to record generated conflicts with `resolution: regenerate` instead of resolving to one side.

Capture preserves the host-local boundary for `.lervo/state` and `.lervo/data` regardless of ignore rules by restoring their `HEAD` entries after staging. Delegation capture depends on whether `HEAD` tracks `.lervo/knowledge/convergence-delegation.json`:

- When tracked, its exact worktree bytes enter the snapshot. Apply, merge, and rollback reproduce those bytes rather than restoring the committed grant.
- When untracked, it remains host-local, never enters a snapshot, and survives apply cleanup. Capture restores its absent `HEAD` entry after staging.

Only the ADR-0466 convergence owner renews or rebinds the delegation. A tracked-file follower writes nothing and receives the owner's exact bytes through replication. An untracked-file follower may adopt the owner's term through ADR-0478's guarded Hub-record path. This convergence ownership rule does not replace repository writer-lease and handoff requirements.

Conflicts confined to `.lervo/knowledge/` and `.lervo/generated/` resolve to the local merging side. The merge reports the resolved path count and the coordinator logs it, so resolution is not silent. This includes a tracked delegation conflict; after reconciliation only the convergence owner writes its next renewal. Other conflicts follow the configured `hold`, `prefer_local`, or `prefer_peer` policy and divergence reporting contract. The former `resolution: regenerate` requirement is no longer operative.

ADR-0478 changes the snapshot-cache fingerprint to `v2`. Both hosts must deploy the changed capture semantics together: mixed versions can compute different snapshots for a renewed tracked delegation and report divergence or fail post-apply verification. Renewals remain uncommitted working-tree changes and are not knowledge publication outputs. Removing a tracked delegation from the index requires ordinary review.

### Error fidelity

Every replica and handoff error carries `code`, `stage` (`protocol | snapshot | bundle | transfer | verify | apply | merge | checkpoint | supersession | lease | rollback`), `gitExitCode` when applicable, and `stderrDigest` of at most 512 characters, passed through event-contract redaction.

The CLI prints the cause chain; the receipt stores the last failure. Watch mode logs each distinct failure once, then reports a counter.

### Superseded knowledge commits

[ADR-0466](0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md) lets the convergence owner supersede `Lervo Knowledge` commits that lost a replay. Replicas must not restore them from the other checkout. Before moving any history, every cycle exchanges both checkouts' supersession ledgers, and each side drops superseded commits at its branch tip. If drops change a snapshot, the cycle observes both sides again. A merge whose result equals the peer's state counts as `pulled`, so a fast-forward after a drop pushes nothing.

If one side still holds superseded commits the other lacks, the cycle stops at stage `supersession` with `repository_replica_superseded_knowledge_held` and moves no history. The peer command `repository-replica knowledge-supersession --root <root>` reads the other side's entries on stdin and prints its reconciliation. A malformed report fails with `repository_replica_supersession_invalid`. Both hosts must run a build containing this command, so the coordinator and WSL Node deploy together. [ADR-0468](0468-propagate-knowledge-supersession-across-replicated-checkouts.md) defines the ledger and drop rule.

### Checkpoint reconciliation

Workstream import surfaces exact blocker codes in health and attention: `invalid_snapshot | identity_changed | origin_changed | non_advancing_revision | divergent_heads`.

`lervo workstream reconcile` creates a successor whose `origin` names both predecessor heads. ADR-0201's successor rule extends to allow a reconciliation successor to replace two heads. No head body is ever merged. As amended by ADR-0561, the newest valid head is kept without an owner choice and `--keep` is removed ([checkpoint reconciliation](../../../specifications/coordination/workstream-checkpoint-reconciliation.md)).

The [checkpoint reconciliation contract](../../../specifications/coordination/workstream-checkpoint-reconciliation.md) defines exact parent binding, CLI-only publication, deployment compatibility, and interruption recovery.

## Events, states, and failure meaning

- `repository.handoff.completed`: `handoffId`, `repositoryIdentityHash`, `direction` (`to_peer | from_peer`), `sourceSnapshotHash`, `workstreamSnapshotHash` or null, `leaseHolderHostHash`, `previousHolderHostHash` or null, `protocolVersion`, `occurredAt`. Absence means handoff did not complete.
- `repository.handoff.failed`: `handoffId`, `stage`, `failureCode`, `rolledBack` (boolean), `occurredAt`. `rolledBack: false` requires inspection of the receiving repository before any write.
- `repository.writer.lease.changed`: `repositoryIdentityHash`, `holderHostHash` or null, `previousHolderHostHash` or null, `reason` (`handoff | handback | manual_release | reconcile`), `staleAfter` or null, `occurredAt`.
- `repository.replica.diverged`: `replicaId`, `divergenceId`, `localSnapshotHash`, `peerSnapshotHash`, `commonSnapshotHash`, `conflictPathCount`, up to 16 `conflictPathDigests`, `occurredAt`.
- `repository.replica.reconciled`: `divergenceId`, `strategy`, `resultSnapshotHash`, `occurredAt`.
- New failure codes: `repository_replica_protocol_mismatch`, `repository_replica_config_stale`, `repository_writer_lease_held_elsewhere`, `repository_handoff_partial`, `lease_stale`.
- `repository_replica_superseded_knowledge_held` (stage `supersession`): one checkout retains superseded knowledge commits the other lacks. No history moved; the local receipt records it as `lastFailure`.
- `repository_replica_supersession_invalid`: the peer's supersession report failed validation.

Events contain hashes of hosts, snapshots, and paths, never paths, credentials, SSH destinations, or diff content. Redacted `stderrDigest` stays in local logs and receipts, never canonical events.

## Migration

1. Ship error fidelity, explicit exclusions, and divergence events; healthy replicas retain their behavior.
2. Add the protocol handshake with current versions. Both hosts must run the same build before step 3.
3. Introduce leases as `not_configured` by default. Enable each repository with `lervo repository handoff init`, starting with the Lervo repository removed from replication.
4. Retire `repositoryReplica.required` after every configured repository has a lease.
5. Resolve the plen, flemo, and digimon backlog through `reconcile`, recording `reconciled` events as the acceptance baseline.

Step 1 exclusions follow the amended tracked-versus-untracked rule above. ADR-0478 additionally requires deploying CLI and Node bundles to both hosts and restarting Nodes and host resident services in one maintenance window before relying on tracked-delegation parity. These are rollout requirements, not evidence that rollout or acceptance scenarios completed.

## Acceptance (installed)

- Hand off the Lervo repository from Mac to WSL with an uncommitted edit and advanced workstream. The Discord Node continues the workstream, changes bytes, and hands back. Both hosts show identical snapshot hashes and one lease history.
- An injected two-sided edit produces one `diverged` and one `reconciled` event in the same cycle, with the losing side on a backup branch (ADR-0561).
- An injected protocol mismatch fails closed with its code. An injected Git failure exposes its stderr digest in CLI output and the receipt.
- A Node without the lease refuses a mutating Discord request with a reply naming the holder, while still answering read-only requests.
- Seven days of fleet operation record no repeated identical failure beyond the once-per-identity rule.

## Deferred

Hub artifact transport for bundles, concurrent multi-writer repositories, and automatic merge policies beyond `hold` and `prefer` remain out of scope.

## References

- [ADR-0396](0396-conflict-safe-repository-replica-continuation.md)
- [ADR-0201](0201-repository-scoped-workstream-replication.md)
- [ADR-0415](0415-bounded-replica-transport-and-service-completion.md)
- [Mac-offline source handoff roadmap](../../../roadmap/product-outcome-convergence/host-products/discord/source-handoff.md)
- [Replica divergence and merge specification](../../../specifications/coordination/node-change-driven-work/repository-replicas/divergence-and-merge.md)
