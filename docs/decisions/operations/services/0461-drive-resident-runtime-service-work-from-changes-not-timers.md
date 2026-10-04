# ADR-0461: Drive resident runtime service work from changes, not timers

Status: `accepted`
Decision date: 2026-10-05
Amends: [ADR-0433](../../knowledge/repository/canonicalization/0433-own-background-knowledge-for-every-repository-change.md), [ADR-0399](../../coordination/sync/0399-change-driven-repository-and-conversation-work.md), [ADR-0415](../../coordination/sync/0415-bounded-replica-transport-and-service-completion.md), [ADR-0458](../../execution/orchestration/improvement/0458-learn-from-single-observations-and-run-standing-autonomy.md)
Related: [ADR-0164](0164-user-runtime-service-management-boundary.md), [ADR-0165](0165-runtime-readiness-and-preflight-boundary.md), [ADR-0450](../../knowledge/repository/canonicalization/0450-keep-background-knowledge-out-of-developer-flow.md)
Evidence: [Hub host load measurement, 2026-10-05](../../../evidence/operations/hub-host-load-2026-10-05.md)

## Context

The Hub host (Windows, Ryzen 5 7500F 6c/12t, WSL2 with six vCPUs) runs at ≥ 60 °C, ≥ 4,000 MHz
and ≥ 2,000 RPM while idle. Measured read-only on 2026-10-05 after the `25d1abc9` deployment
settled (method and full tables in the evidence document):

- Windows: `vmmemWSL` 547 % of one logical processor, `System` 32 %, nothing else above 3 %;
  Balanced power plan with boost engaged (`% Processor Performance` 132 %). The heat is the VM.
- WSL, 60 s: 559 % of one core busy (90 % of six vCPUs). Six `knowledge-worker` residents 233 %,
  six Node service mains 75 % (the two standing-supervision mains 70 of it), short-lived
  `repository-replica snapshot`/`receipt` processes from the Mac coordinator 63 % (23 per minute),
  Argo 90 % (protected), Hub 0.3 %. Lervo ≈ 372 % of one core, 62 % of the VM, ~31 % of the
  machine, while the event stores recorded no knowledge work (lervo's last event was 15 h old).
- systemd on the lervo Node unit: `Consumed 1h 3min 19s CPU time over 51min 39s wall clock`.
- Each resident runs a single-threaded 100 % burst every 60 s (11–44 s; the lervo cycle exceeds
  60 s and never pauses), reading 146 MB–2.6 GB per 45 s. The standing mains reopen and read
  `events.sqlite` at 25 MB/s, one full pass over 108 MB every 4–5 s.

### Root causes, verified in source

1. **The knowledge resident re-verifies the whole repository and replays the whole event log on a
   fixed 60 s timer, twice per cycle, even when nothing changed.**
   `packages/repository-knowledge-runtime/src/loop.ts:106` runs `setInterval(cycle, 60_000)`
   beside the event wakeups. Each cycle (`worker.ts:66-103`) calls `processKnowledgeConvergence`,
   which calls `host.discover()` at the start (`knowledge-convergence-owner.ts:54`) and again for
   the final status (`:378`). Each `discover` (`baseline.ts:20-139`) runs one
   `scanConfiguredRepositoryKnowledge`, two full `captureConvergenceSources` (`:30`, `:39`) that
   `readFileSync` and SHA-256 every tracked and untracked file (`source-capture.ts:84-104`; 6,914
   files in lervo), two `captureConvergenceChangedPaths`, `inspectConfiguredDocumentNormalization`,
   `inspectRepositoryKnowledgeCurrency` (two more scans, five plan builders, a lint;
   `knowledge-currency.ts:30-66`), `listCanonicalizationCandidates` (readdir over 472 shard
   directories) and `historicalObligations`. One idle cycle is four byte captures and six scans.
   `replayKnowledgeConvergence` (`knowledge-convergence-replay.ts:21-74`) pages and JSON-parses the
   whole store and runs three to four times per cycle (`owner.ts:55`, `:159`, `:232`, `:378`).
   Nothing short-circuits when nothing changed, so cost scales with repository and history size.
2. **Standing supervision pages the entire event store on every cycle.**
   `apps/node-runtime/src/outcome-supervision-runtime.ts:108` wraps `withOwnerLease` (`:209`) and
   `readSnapshot` (`:226`) in `assertRequestBound()` → `findBoundSupervisionRequestEvent`
   (`supervision-request-presence.ts:8-39`), a full walk of up to 100,000 events to find one
   `work.supervision.bound` event that cannot change after startup. The loop
   (`supervision-change-loop.ts:14`, 5 s) spins at that interval whenever the report's
   `nextCheckAt` lies in the past (`conversation-change-loop.ts:125`), the state of a lineage whose
   progress deadline lapsed. `SupervisionAuthorityHistory.readVerified`
   (`supervision-authority-history.ts:90`) and `supervision-result-branch.ts:122` re-read the whole
   store every 60 s. `SQLiteEventStore.list` (`event-repository.ts:144-163`) has no type filter, so
   every walk parses all 60,168 payloads.
3. **The Mac replica coordinator polls four repositories every 30 s and each poll re-hashes both
   working trees.** `~/.lervo/repository-replica-coordinator.json` sets `pollIntervalMs: 30000`,
   `peerWatch: false`; `repository-replica-watch.ts:33` then reconciles every replica every 30 s
   regardless of change. Each reconcile runs a local snapshot, `ssh … wsl.exe … repository-replica snapshot` on the peer and two receipts (`repository-replica-coordinator.ts:367-369`).
   `captureRepositoryReplicaSnapshot` (`repository-replica-git.ts:95-141`) copies the index,
   `read-tree HEAD` into it (discarding every stat-cache entry) and runs `git add -A`, so git
   re-reads and re-hashes every file on every poll although all replicas have been `current` for
   days. Windows additionally spawns `sshd`, `conhost`, `wsl.exe` and `/init` per poll.

Verified non-causes: the 2,000 ms sync idle poll (Hub long-poll; Hub 0.2 %, plain Node mains
0.4–3 %), the 1 s event-watch fallback, Defender (2.3 %), Windows Search, Docker (idle) and the
power plan, which follows the load. Argo is 16 % of the VM and is not stopped, throttled or
rescheduled by this decision.

## Decision

Resident Lervo services do work only when something changed, observe each change once per cycle,
read event history incrementally through verified cursors, and back their reconciliation timers
off to a ceiling while idle. The caches that make this cheap are rebuildable private projections
(invariant 4) and never claim currency (invariant 3).

### 1. Knowledge resident

- **Change fence.** New `packages/repository-knowledge-runtime/src/source-fingerprint.ts` with
  `convergenceSourceFingerprint(storage)`: `sha256(canonicalJson({ head, status: sha256(git status --porcelain=v2 -z --untracked-files=all), index: {size, mtimeNs}, policy: hashes of the files convergenceSourceCaptureSettings reads, delegation: hash of CONVERGENCE_DELEGATION_PATH, candidates: sha256 of shard names and mtimes under .lervo/state/knowledge/*-candidates, eventsHead: events.latest()?.eventHash, outboxOutstanding for the convergence, repository and requeue destinations, earliestAvailableAt }))`. Tens of milliseconds.
- **Skip rule** in `startAutonomousKnowledgeWorker` (`loop.ts`): when the previous cycle returned
  `processed` with no outcomes and `convergence.state` in `idle | waiting_authority | attention_required | recovery_required` and the fingerprint is unchanged, skip the cycle, heartbeat `idle` with
  reason `source_unchanged`, increment `idleStreak`. A due `earliestAvailableAt` always runs.
- **Adaptive reconciliation.** Replace `setInterval` (`loop.ts:106`) with a one-shot timer of
  `min(ceiling, base × 2^idleStreak, earliestAvailableAt − now)`, `base = 60_000`,
  `ceiling = 900_000`; `schedule()` wakeups and non-idle results reset the streak; the ceiling cycle
  runs without the fence, bounding undetected staleness to 15 minutes. Lift the `> 60_000` guard at
  `loop.ts:19` to the base.
- **Repository wakeups.** `apps/node-runtime/src/knowledge-worker-cli.ts:59` passes a composed
  `subscribe`: `watchProjectEventChanges` plus `watchRepositoryChanges(root)`
  (`repository-change-watch.ts`), so edits wake the resident instead of the timer.
- **One observation per cycle.** In `processKnowledgeConvergence`, compute
  `replayKnowledgeConvergence` once and pass the rows to `discover`, `resumeDependencies`,
  `reconcileKnowledgeConvergenceOutbox` and `convergenceStatus`; reuse the `discover()` baseline at
  `:378` when no stage ran. In `discoverConvergenceBaseline` replace the second full capture
  (`baseline.ts:39`) with a before/after fingerprint comparison; give
  `inspectRepositoryKnowledgeCurrency` a `preparedScan` option. `snapshotHash`, `policyHash` and
  `debtDigest` are computed exactly as today; no event payload changes.
- **Content-hash cache.** `captureConvergenceSources` consults
  `.lervo/state/knowledge/source-hash-cache.sqlite` keyed by `(path, size, mtimeNs, ino)`; misses
  read, hash and upsert; absent paths are pruned; 50,000-row bound. Output bytes are identical.
- **Host-wide cycle admission.** A host lock beside the provider admission directory
  (`provider-admission.ts`), concurrency 1, taken only for full cycles, so six residents on one
  host serialise bursts instead of stacking them.

### 2. Standing supervision

- `BoundSupervisionRequestPresence` in `supervision-request-presence.ts`: full scan once at
  startup (same semantics, conflicting origins still throw), then incremental scans from a
  `{seq, eventHash}` cursor verified like `SupervisionAuthorityHistory`; anchor failure → full scan.
- `readVerified` (`supervision-authority-history.ts:90`) keeps the 60 s audit as anchor-and-tail
  verification; a full re-read every 900 s or on anchor failure. The owner may keep the 60 s full
  re-read for security at a floor of about 8 % of a core on the lervo main.
- `supervision-result-branch.ts:122` and `supervision-standing.ts:65` keep cursors with the same
  anchor rule.
- `ConversationChangeLoop` (`conversation-change-loop.ts:114-130`) gains
  `idleBackoff?: { baseMs, ceilingMs }`: when the deadline has passed and the cycle reported no
  change, the delay doubles from `intervalMs` to the ceiling; `notify()` resets it.
  `createSupervisionChangeLoop` passes `{ baseMs: 5_000, ceilingMs: 300_000 }` and reports "no
  change" when `outcome-supervision-cursors.ts` left the digest and `blocked` state unchanged.
- `ListEventsOptions` (`packages/storage-contract`) gains `types?: readonly string[]`;
  `event-repository.ts:144` adds `AND type IN (…)` with an index on `(project_id, type, seq)`.
  `findBoundSupervisionRequestEvent`, `resolveStandingRoot`, `scanForStandingLineageChange` and
  `replayKnowledgeConvergence` pass their types. Additive; omitting `types` behaves as today.

### 3. Replica coordinator

- `captureRepositoryReplicaSnapshot` first computes
  `sha256(canonicalJson({ head, branch, index: {size, mtimeNs}, status: sha256(git status --porcelain=v2 -z --untracked-files=all) }))` and compares it with `<git-dir>/lervo-replica/snapshot-cache.json`; a hit returns the cached snapshot without touching an index; a miss runs today's capture and rewrites the cache. Both sides share the function.
- `watchReplicaReconciliation`: while every replica's last result was `current`,
  `recoveryIntervalMs` doubles up to a new key `idleRecoveryCeilingMs` (default 600,000;
  validated 30,000–3,600,000 in `repository-replica-config.ts`); a local hint or a non-`current`
  result resets it to `pollIntervalMs`. The health snapshot adds `recoveryIntervalMs`.
- `RepositoryReplicaCoordinator.reconcile` skips the peer receipt when the status is `current` and
  the receipt equals the last one written for that replica; the local receipt is always written.
- Owner-side (Mac): set `peerWatch: true` and `idleRecoveryCeilingMs`. `peerWatch` was disabled on
  purpose; the owner decides whether that reason still holds. Without it the cache and back-off
  alone remove about 90 % of the cost.

## Events, states and failure meaning

No new canonical event. New private, rebuildable state:

- `.lervo/state/knowledge/resident-cycle.json`: `{ schemaVersion: 1, fingerprint, lastCycleAt, lastResult: "idle" | "waiting" | "attention" | "processed", idleStreak, nextReconcileAt }`; digests and timestamps only; missing or invalid → next cycle is full.
- Resident health reason `source_unchanged` (existing `reason` column, ≤ 128 chars) with state `idle`; proves the fence skipped work, never document currency.
- `.lervo/state/knowledge/source-hash-cache.sqlite`: `(path, size, mtime_ns, ino, sha256, kind)`; paths already appear in baselines; corrupt → delete and rebuild.
- `<git-dir>/lervo-replica/snapshot-cache.json`: `{ schemaVersion: 1, fingerprint, snapshot }`; hashes and branch name; never tracked; mismatch → full capture.
- Supervision presence cursor and loop back-off are in memory; anchor failure → full rescan.
- `repository-replicas.health.json` gains `recoveryIntervalMs` (informational).

## Host-level options (owner approval, separate from code)

- Argo: 90 % of a core from an interactive shell (`init.scope`). Owner-only options, not planned
  here: a training window, a user unit with `CPUQuota`/`Nice`, or no change.
- Power plan: `powercfg /setacvalueindex SCHEME_CURRENT SUB_PROCESSOR PERFBOOSTMODE 0` (or 99 %
  maximum state) lowers temperature and fan speed at the cost of peak clocks. Optional.
- `.wslconfig processors=6`: lowering it caps the VM but slows Argo and builds. Not recommended.
- Defender exclusion for the VHDX directory: `MsMpEng` is 2.3 %; marginal.

Expected steady state (% of one core): residents 233 → ≤ 12, mains 75 → ≤ 6, replica 63 → ≤ 4,
Lervo 372 → ≤ 22, Argo 90 unchanged, VM 559 → ~115 of 600 (table in the evidence document).

## Implementation plan

Each step: unit tests, `pnpm quality:check`, `pnpm release:completion:check --base <rev>`,
reviewed release intent per ADR-0221, deployment through `~/delivery/wbuild-<rev>.sh` and
`~/delivery/nup-<rev>.sh`, then the measurement in the evidence document. Rollback: re-point the
units at the retained `~/.local/lib/lervo-node/runtime-<previous>-r1` and restart; for the Mac,
restore the coordinator JSON and `launchctl kickstart -k gui/$UID/dev.lervo.repository-replica`.

1. Record a ten-minute baseline with the evidence method.
2. Decision 1, first five bullets. Tests: back-off 60 s → 2 → 4 → 8 → 15 min with reset on wakeup;
   fence unchanged on an untouched tree and changed after edit, untracked file, delete, commit,
   policy edit, delegation edit, candidate shard change, new event, outbox change; fixtures assert
   one `discover` and one replay per idle cycle. Expected residents 233 → ≤ 20.
3. Decision 2. Tests: incremental presence equals the full scan, including a late conflicting
   origin; back-off on a lapsed deadline and reset on notify; `types` filter equivalence.
   Expected mains 75 → ≤ 6.
4. Decision 3. Tests: cached snapshot equals a fresh capture for unchanged tree, modified tracked
   file, new untracked file, deleted file, moved HEAD, ignored file, index-only staged change;
   back-off and reset on hint. Deploy the Mac bundle; owner applies the config. Expected 63 → ≤ 4.
5. Decision 1, last two bullets. Tests: cache hit and miss give byte-identical `sources` and
   `snapshotHash`; two residents never hold the full-cycle lock together. Expected ≤ 12 and the
   lervo ceiling cycle under 10 s.
6. Present the host-level options with the post-fix measurement.

## Acceptance

Measured read-only with the evidence method: VM busy < 25 % over five minutes with Argo running;
each `knowledge-worker` < 3 % averaged over ten minutes and 0 % between cycles with
`source_unchanged` heartbeats; each standing main < 5 % and under 10 MB/min read from
`events.sqlite`; ≤ 1 `repository-replica snapshot` per replica per 10 minutes while the Mac trees
are unchanged, with `recoveryIntervalMs` at the ceiling; `% Processor Performance` ≤ 100 % and
`vmmemWSL` < 150 % of one logical processor over five minutes; owner-recorded temperature and fan
speed below the baseline. Negative: a tracked-file edit wakes the resident within 2 s and the next
cycle runs in full; a Mac commit reconciles within one poll; a lapsed supervision deadline still
re-evaluates within 300 s; `lervo knowledge lint` and the convergence and replica suites pass.

## Deferred

A host-level scheduler across Node units, one resident per host, per-path incremental baselines.

## References

- [Repository knowledge compilation](../../../specs/repository-knowledge-compilation.md)
- [ADR-0221 reviewed CLI release preparation](../../release/packaging/0221-reviewed-cli-release-preparation.md)
