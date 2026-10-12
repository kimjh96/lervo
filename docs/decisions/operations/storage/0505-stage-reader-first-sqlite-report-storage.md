# ADR-0505: Stage reader-first SQLite report storage

Status: accepted
Date: 2026-10-11

## Context

Context-quality recording pays for private report durability and event publication. The retained SQLite prototype can publish both in one transaction, but it bypasses the generic CAS URI reader and uses an unversioned fixture table. Its cold resource results remain above the acceptance limit. Copying that prototype into the recording application would break reader compatibility and leave privacy, migration and lifecycle behavior undefined.

[ADR-0003](0003-local-event-store-and-cas.md) assigns storage mechanics to adapters, and [the recording contract](../../../specifications/execution/context-quality/recording-storage-reuse.md) retains complete report verification and fresh authority checks. This decision establishes the reader and format boundary needed to evaluate a real implementation; it does not declare performance completion or activate a production writer.

## Decision

Keep ordinary store creation and migration at storage format 3. Add format 4 as an explicit `SQLiteEventStore.open` option, `reportStorage: "sqlite_v1"`, requiring writer envelope version 6 in that opening coordinate. The storage adapter does not grant project authority: its caller must own current writer selection, reader compatibility and rollout evidence. No CLI switch or automatic fleet activation is added.

Format 4 adds `quality_reports` and ordered `quality_report_chunks` tables. Header metadata identifies the codec, original hash and byte length, encoded length and chunk count. The private codec and repository enforce the bounds in the recording specification. The transition runs inside the existing atomic schema/project-binding initialization transaction. Project conflict or DDL failure rolls back the new tables, schema version and metadata together. Conflicting preexisting tables are rejected rather than overwritten.

Updated writable, read-only and offline inspection paths support formats 3 and 4. They reject an incomplete format-4 layout and retain format 4 when opening an already migrated store. A report reader belongs to the event-store connection and rejects reads after closure. Application code receives a provider-neutral optional `ReportReader` through the storage contract, not a database handle or access to a private repository.

Project storage composes that reader with its existing artifact adapter. `get` and `has` resolve the same `lervo-cas://sha256/…` URI. A complete verified SQL report is returned first; only absence permits fallback to the filesystem CAS. Corruption remains a failure even when CAS contains a valid copy. Ordinary puts, streams, custom adapters and cleanup retain their existing owners. This is an internal shared-runtime contract, not a public SDK.

Report bodies remain private. An explicit format transition and writable reopening of format 4 secure the database and existing WAL, SHM and rollback-journal files to owner-only permissions using checked file descriptors. Subsequent SQLite auxiliary files inherit the database mode. Read-only format-4 opening verifies private regular files and rejects unsafe permissions. Unix mode checks do not assert Windows ACL verification; Windows retains the existing platform permission model and requires its own installed qualification. Permission changes precede the SQL transaction and are not claimed to roll back with schema changes.

The current source exposes report reading, explicit format initialization and an opt-in adapter transaction writer. Each opening selects `reportStorage: "sqlite_v1"` or `"existing_sqlite_v1"` with writer version 6 to receive that write capability. The latter mode grants the capability only when the store already has format 4; it never migrates format 3. An ordinary opening without either selection remains reader-only for reports. The adapter commits reports and events together with strong synchronization and two complete report verifications. The pooled project-storage opener selects existing-format support under the freshly observed writer-6 coordinate. Quality recording uses its provider-neutral report writer when available and retains CAS otherwise. A failed selected SQL write never falls back to CAS. The original source preparations, read-only outcome verifier, authority observations, failure drains and frozen resource gates remain mandatory.

## Compatibility and rollback

Existing format-3 readers reject format 4. Do not activate the format in a repository shared with those binaries. A reader-first rollout must install compatible binaries before selecting the new format. Lowering the event writer version stops new quality events but does not downgrade the database format or erase reports. Rollback therefore needs a format-4-capable predecessor or a separately verified backup/recovery plan; no automatic destructive down-migration is provided.

Report contents are not added to event envelopes or outbox payloads. Raw database backups now include private report bytes when reports are written, so backup and retention owners must preserve that privacy boundary. Capacity exhaustion rejects new report publication without deleting immutable history. Owner retention and interrupted-commit evidence remain required before enabling the recording writer.

## Verification and release

Verify default format preservation, explicit-selection rejection, project-conflict and DDL rollback, reopen/read-only reads, missing layout rejection, private file modes, mixed CAS history, corrupt SQL refusal despite a valid CAS copy, custom adapter behavior and closed-handle failure. Preserve all earlier failed resource cohorts. Qualify actual rebuilt distribution artifacts after writer integration; source tests and scratch timings do not close those gates.

The reader and opt-in transaction writer are additive bundled-private changes with reviewed patch intents. Format activation, deployment, publication and production performance acceptance remain separate from this source change.

## Recording selection and cold initialization

The project-storage pool selects existing-format support without changing the generic backend interface. Both an explicitly migrated format-4 database and the current writer-6 coordinate are required. Repository-context snapshots bounded report bytes, computes the expected hash, validates its event payload and supplies both to its existing fixed commit queue. The queue drains preparations, performs the fresh final binding observation, and calls the report transaction port. It compares the adapter result with the expected hash before appending. Conflicting events or hashes roll back the new report; receipts resolve only after the adapter has completed both reads.

The project adapter now supports a separate persistent selection before the event database exists. `.lervo/data/report-storage.json` records an immutable, versioned activation identity and its reviewed evidence. Selection planning requires the current writer-6 coordinate hash, the exact reader IDs and peer identities in that coordinate, artifact hashes with explicit format-3/4 read capability, and a compatible rollback artifact. Event-version capability alone is insufficient. The caller owns those observations and their provenance; declaring a hash does not attest an installed binary.

Planning and apply require evidence observed within five minutes, allowing at most thirty seconds of future clock skew. Apply takes the exact plan ID and a fresh observation with the same readers, artifacts, rollback and writer binding; its observation timestamp may advance. The plan is reconstructed against current repository state before publication. The coordinate is a historical approval and minimum-format selection, not a cached current fleet observation. Inspection does not expire it. Later inventory and deployment owners must continue to honor the format-4 reader and rollback boundary.

Publication creates one owner-only pending file exclusively, synchronizes it and the directory, and links it to the absent final path without overwriting. Pending publication fences inspection. Explicit recovery completes an already approved, valid pending record only when the final file is absent or byte-identical. Conflicting, redirected, oversized or malformed files fail closed and remain for owner resolution. There are at most two fixed files, with no append-only activation log or automatic replacement/downgrade. The coordinate survives event-writer rollback; rollback does not erase the data-format requirement.

Activation publication creates no event database. The project opener freshly reads the selection and, under writer version 6, passes explicit format selection into ordinary atomic SQLite initialization. A backend without the required report writer is rejected instead of silently selecting CAS. Without the persistent coordinate, legacy/default behavior remains unchanged. Retained handles capture the selection hash and compare it with fresh reads at initial borrowing and final commit guards; removal or replacement invalidates the handle even before its first baseline confirmation. These observations do not form an atomic cross-process authority lease.

The cold fixture can therefore start without event schema or project metadata and initialize both inside ordinary recording. This removes the previous existing-format-only gap without precreating the database outside the timer. Owner retention, supported-platform recovery and the original exact-artifact resource gates remain required before performance completion or production activation.

## Bounded observation grouping

The recording owner now uses a private, bounded scope for preparation and verification reports belonging to one observation. Both admitted report kinds finish a member; continuation completion/failure can also finish it. A group releases after all members finish or its referenced fifty-millisecond backstop expires. Held groups do not enter another ready batch. Every selected preparation drains before the existing final binding check and adapter transaction. A backstop or late arrival can produce separate commits, so a functional receipt does not prove the latency gate passed. Complete reports, both readbacks and all receipts remain mandatory.

CAS handles retain their path guards but initialize optional native capabilities only when a CAS operation uses them. The SQL report path need not load an unused addon. No weaker synchronization, report omission or timer exclusion follows from either change.

## Report checkpoint policy

Direct actual-module observations measure strong report COMMIT at approximately sixteen milliseconds with a checkpoint threshold of one page. An isolated threshold-256 experiment preserves strong synchronization and reduces that span to approximately four milliseconds. The adapter now exposes an explicit `report_batches` policy: selected format-4 report writers use a 1 MiB target divided by their actual page size, while ordinary event writers use one page. The pool selects this policy. The previous boolean retains its one-page meaning; conflicting or unknown policy inputs fail before database creation. Setting readback precedes initialization commit and fails closed on disagreement.

This changes checkpoint scheduling, not the report writer's FULL, fullfsync or checkpoint_fullfsync requirements. Automatic checkpoint cost remains in the committing operation, and both complete report reads precede receipts. Default independent openers keep their existing policy. The threshold and zero retained-journal target are not an unconditional size ceiling: active readers and large transactions can retain more WAL. Tests cover reader-held growth, release/reclamation, complete reopen reads and transaction rollback on configuration failure. No report or event is pruned. Retention ownership, supported-platform recovery and the unchanged exact-artifact resource gates remain required.

## Fixed observation groups and initial page layout

Scopes registered for the same root before the first queue admission form one group, capped at eight observations. First admission, explicit member completion or the eighth registration fixes membership; later requests enter another group. All members finish through both report admissions or continuation cleanup before release, with the original fifty-millisecond backstop starting at the first member. Unrelated ready groups and unscoped reports remain eligible for their own commit. Group release never grants authority or a durable receipt, and every selected preparation still drains before the fresh final guard.

A new explicitly selected report database with zero pages uses 2 KiB physical pages before WAL setup. Existing layouts are preserved, including migration from format 3. This changes no table, index, report codec or logical storage version. The checkpoint threshold adjusts to actual page size so the previous 1 MiB target remains constant. The measured failures remain retained; neither grouped commits nor smaller pages establish latency, CPU or state acceptance without a new exact-artifact cohort.

## Joint current coordinate observation

Project storage now requests writer and report-selection coordinates through one project-owned observation. Each call reads a new validated manifest once, then preserves both pending-activation fences, data-directory validation and complete coordinate-file checks. No observation or authority is cached. A private writer-file reader is shared with the unchanged standalone writer API; consumers receive only the joint inspection result, never permission to inject an older manifest.

The opener keeps its manifest read before legacy migration and obtains fresh coordinates afterward. A changed project ID fails with `storage_binding_changed` before backend opening. Retained-handle admission and final guards compare the fresh joint result with the original handle, alongside all path identities. This reduces duplicate manifest work within one observation without treating multiple filesystem reads as an atomic authority lease. Exact resource measurement remains required.

## First-source acquisition overlap

Enabled scoped observations now begin bounded cold storage opening while their first source preparation runs. This happens inside the observation call and its resource timer. Existing entries skip only the extra opening attempt; actual report admission and final commit still require fresh binding checks. Opening uses the same pool bounds and releases its borrowed slot before waiting for source preparation. Idle retirement may require a later reopen and does not extend to keep speculative work alive.

The owner drains opening before continuing, including after source failure. Opening failure remains the preparation attempt's bounded recording failure rather than an implicit retry or durable success. Ordinary awaited preparation and disabled recording retain their prior behavior. This changes scheduling, not activation authority, synchronization, full-report reads or receipts. Exact-artifact resource evidence remains required; earlier failed cohorts are retained.

## Prepared report groups before storage admission

Use the opener's transient capability hint to select prepared SQL scheduling, never to grant authority. Complete private report bytes, validated event metadata and fixed ready membership precede one storage borrow. Its full fresh observation is the final guard immediately before synchronous publication; the adapter retains atomic appends, strong synchronization and both complete reads.

The [prepared admission contract](../../../specifications/execution/context-quality/recording-storage-reuse.md#prepared-sql-report-admission) owns the shared legacy/SQL budget, scope admission and expiry, immutable copies, project mismatch, missing capability, retry timestamps and complete failure drains. Legacy and unscoped paths retain their existing effects. This decision does not reuse authority for late arrivals or establish resource acceptance, retention readiness or deployment authority.
