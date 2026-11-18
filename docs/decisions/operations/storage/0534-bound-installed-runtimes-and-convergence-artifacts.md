# ADR-0534: Bound installed runtimes and convergence artifacts

Status: `accepted`
Decision date: 2026-10-25
Amends: [ADR-0219](0219-typed-derived-state-retention.md), [ADR-0518](0518-retire-settled-convergence-checkouts-on-every-host.md)
Amended by: [ADR-0584](0584-let-cas-retention-finish-a-pass-on-a-live-host.md) (collector read bounds, live-change handling and the retention observation), [ADR-0585](0585-release-mirrored-backups-and-settled-assignment-inputs.md) (mirrored event-writer backups and settled assignment inputs), [ADR-0586](0586-release-superseded-stage-records.md) (records of superseded stages)

## Context

The reviewer observed 128 installed Node runtimes using 17 GB on Mac and 2.8 GB of runtimes on WSL. The runtime installer materializes a content-derived directory. Activation changes `current` but never retires an old directory. The CLI install pointer names a separate package and does not own these runtime copies.

The project CAS used 6.8 GB on Mac and 12 GB on WSL. Convergence discovery stores a full baseline input. The owner stores a full input after each stage, and workforce results also embed their input. Stage completion embeds another source capture. CAS deduplicates identical bytes, but changed receipts and stage data produce different objects. Checkout retirement under ADR-0518 leaves these objects intact.

These are two typed lifecycle extensions to ADR-0219. They do not authorize a general reset or pruning of durable local evidence.

## Decision

### Installed Node runtimes

The host retains the current runtime, running process bindings and command references, configured service executables and configuration references, and the last distinct rollback predecessor per service and every locally observed signed-rollout enrollment predecessor. It also retains the newest two other managed runtimes. Only the planned runtime retention stage of `lervo upgrade` retires runtimes; Node deployment and rollback no longer do ([ADR-0579](../../distribution/0579-describe-the-bundled-node-runtime-once-per-upgrade-and-time-its-stages.md)). Repository upgrade plans expose the exact directory identities and reclaimable bytes, and apply reobserves consumers before removing the approved intersection.

A managed directory needs a 16-character hexadecimal name, a regular payload, the matching generated launcher, and the known runtime layout. Dependency links are inspected without traversal and must stay within that runtime. Foreign files, external links, unsafe roots and incomplete reference observations never authorize deletion. Installation, pointer changes, predecessor pins and retirement share one host lock.

A bundle started through `current` records its physical directory in an owner-only PID binding before entering runtime work. Bindings have a 256-entry capacity per runtime; startup removes dead entries and retention ignores them. A binding failure does not prevent runtime work. A running `current` command without a valid physical binding defers retirement. This protects older processes until their normal replacement establishes a binding.

Retirement processes the whole approved candidate set from an inventory capped at 4,096 entries. One private journal records a detach before the rename. The next apply resumes removal of its detached tree. No link is followed out of the runtime root. Rollback pins have at most 1,024 service or enrollment keys and a four-MiB byte bound. Service updates replace their predecessor; enrollment pins remain protected. Signed rollout apply resolves the enrolled executable by its launcher hash before any service effect. An unresolved historical enrollment conservatively pins the existing managed inventory.

### Project convergence CAS

The [project CAS specification](../../../specs/background-knowledge-convergence/recovery-and-retention/project-cas.md) owns exact reachability. Only hashes directly named by convergence input, result, dependency or evidence fields enter the collectable class. Every other CAS object remains protected. [ADR-0586](0586-release-superseded-stage-records.md) adds verified stage results, failure proofs and observations of superseded stages to that class. Candidates need both object modification time and their latest direct convergence reference to be older than fourteen days.

Open obligations root every event payload reference. Each settled obligation roots its latest settled stage. Historical normalization-apply results, terminal lifecycle receipts, and the latest parked dependency remain roots for existing readers. Every other subsystem event and persisted record remains a root. References propagate through CAS bodies and logical SQLite cells. Unknown or unreadable references fail closed.

Every host collects under the existing repository knowledge worker lock, before owner-only convergence work. A live developer lease, cancellation, a yield request or materialization work defers collection. Each cycle reads at most sixty-four reference chunks, each at most one MiB and at most eight MiB in total, and removes at most thirty-two objects. A 100 ms body-scan deadline yields between chunks. Metadata inventories and canonical event replay have separate finite limits. A completed pass waits twenty-four hours before starting another grace horizon.

The scan is a bounded, checksummed, replaceable private projection. New or changed reference files must be scanned before sweep. Event-head and inventory changes stop deletion. Each unlink removes one unreachable immutable object. Interruption can leave uncollected objects; it never rewrites an event, candidate or surviving artifact. The next cycle resumes from current references.

### Observation and proof contracts

`cas-retention-observation.json` replaces one owner-local status with required fields `schemaVersion: 1`, `observedAt`, `status`, `removedObjects` and `reclaimedBytes`. `status` is `yielded`, `collected` or `unavailable`. Counts include only completed unlinks in that invocation. `yielded` claims no completed pass; `unavailable` means reference validation or maintenance failed and remaining objects stay intact. A crash can prevent this observation, so it is not an accounting ledger. It contains no paths, hashes, bodies, credentials or exception text. No event schema or writer activation changes.

Runtime plans add `runtime_retention` with `current`, `safe_apply` or `deferred`. `runtime_references_unavailable` means no deletion authority. The plan contains local opaque runtime names, metadata identities and byte totals. PID bindings contain only schema version, process ID, opaque process-birth identity and runtime directory; rollback pins contain service-path digests and runtime names. These records stay host-local.

Full source-list deduplication is deferred. A new stored-input envelope would need to reconstruct the exact original baseline, stage input and receipts before every existing hash check. Retention does not change any current hash or proof meaning. A follow-up must verify old and new envelopes through owner resume, workforce result recovery, receipt verification, normalization lineage and canonical disposition replay.

## Consequences

Mac and WSL use the same policy and local worker lock. No Hub, provider call, new cleanup command, user-owned rewrite or foreground restart is needed. Unresolved references, retained assignments and historical proof chains can keep substantial CAS bytes. Collection does not promise that every settled artifact is disposable.

The observed runtime average is about 133 MB per directory. Keeping four to eight distinct protected or recent runtimes would release roughly 15.9–16.5 GB of the Mac's 17 GB. The comparable WSL upper estimate is about 2.6–2.7 GB if its directory distribution is similar. More active services or unresolved bindings reduce those estimates.

The CAS totals alone cannot identify the reachable share. If 50–90% is old and unreachable after this conservative graph, the Mac releases about 3.4–6.1 GB and WSL about 6–10.8 GB. These are scenarios, not measured savings. Retained assignment archives and normalization lineage may lower them sharply. No live host cleanup was run for this change.

## Verification

Focused tests are written for runtime protection, platform parity, external links, internal dependency links, late process starts and interrupted detach recovery. CAS tests cover open and settled roots, other subsystem events and records, SQLite overflow cells, grace, worker exclusion, developer yield, interrupted unlink and the per-cycle deletion limit. Reader tests cover normalization lineage, parked carry and status, settled-stall reevaluation and missing canonical-disposition inputs.

The owner explicitly prohibits executing tests in this worktree. Static checks and release completion evidence are reported separately. Installed cross-host reclamation and proof replay remain reviewer acceptance work.

Physical bindings reuse the process-birth observer from `node-work-admission` under ADR-0504. Only a matching birth identity can explain a command started through `current`. A reused PID, legacy binding without birth evidence, a different observation scheme or unknown metadata cannot establish that match. Proven absence or a changed birth within the same scheme permits stale-binding protection to end. Birth hashes remain local; boot identifiers and raw process start times are not stored in retention state.
