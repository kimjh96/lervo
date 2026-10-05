# ADR-0461: Drive resident runtime service work from changes, not timers

Status: `accepted`
Decision date: 2026-10-05
Amends: [ADR-0433](../../knowledge/repository/canonicalization/0433-own-background-knowledge-for-every-repository-change.md), [ADR-0399](../../coordination/sync/0399-change-driven-repository-and-conversation-work.md), [ADR-0415](../../coordination/sync/0415-bounded-replica-transport-and-service-completion.md), [ADR-0458](../../execution/orchestration/improvement/0458-learn-from-single-observations-and-run-standing-autonomy.md)
Related: [ADR-0164](0164-user-runtime-service-management-boundary.md), [ADR-0165](0165-runtime-readiness-and-preflight-boundary.md), [ADR-0450](../../knowledge/repository/canonicalization/0450-keep-background-knowledge-out-of-developer-flow.md)
Evidence: [Hub host load measurement, 2026-10-05](../../../evidence/operations/hub-host-load-2026-10-05.md)

## Context

The Hub host (Windows, Ryzen 5 7500F 6c/12t, WSL2 with six vCPUs) runs at ≥ 60 °C, ≥ 4,000 MHz, and ≥ 2,000 RPM while idle. Read-only measurements on 2026-10-05, after deployment `25d1abc9` settled, found the following; the evidence document contains the method and full tables.

- Windows: `vmmemWSL` used 547 % of one logical processor, `System` 32 %, and nothing else exceeded 3 %. The Balanced power plan had boost engaged (`% Processor Performance` 132 %). The VM caused the heat.
- WSL over 60 s: 559 % of one core busy (90 % of six vCPUs). Six `knowledge-worker` residents used 233 %; six Node service mains 75 % (70 from the two standing-supervision mains); short-lived `repository-replica snapshot`/`receipt` processes from the Mac coordinator 63 % (23 per minute); Argo 90 % (protected); Hub 0.3 %. Lervo used ≈ 372 % of one core, 62 % of the VM, and ~31 % of the machine while event stores recorded no knowledge work; lervo's last event was 15 h old.
- systemd on the lervo Node unit reported `Consumed 1h 3min 19s CPU time over 51min 39s wall clock`.
- Each resident ran a single-threaded 100 % burst every 60 s, lasting 11–44 s; the lervo cycle exceeded 60 s and never paused. Residents read 146 MB–2.6 GB per 45 s. Standing mains reopened and read `events.sqlite` at 25 MB/s, traversing 108 MB every 4–5 s.

### Root causes, verified in source

1. **Knowledge residents re-verify the repository and replay the entire event log on a fixed 60 s timer, even without changes.** `packages/repository-knowledge-runtime/src/loop.ts:106` runs `setInterval(cycle, 60_000)` alongside event wakeups. Each cycle (`worker.ts:66-103`) calls `processKnowledgeConvergence`, which calls `host.discover()` at the start (`knowledge-convergence-owner.ts:54`) and for final status (`:378`). Each `discover` (`baseline.ts:20-139`) performs one `scanConfiguredRepositoryKnowledge`, two full `captureConvergenceSources` (`:30`, `:39`) that `readFileSync` and SHA-256 every tracked and untracked file (`source-capture.ts:84-104`; 6,914 files in lervo), two `captureConvergenceChangedPaths`, `inspectConfiguredDocumentNormalization`, `inspectRepositoryKnowledgeCurrency` (two more scans, five plan builders, and a lint; `knowledge-currency.ts:30-66`), `listCanonicalizationCandidates` (readdir over 472 shard directories), and `historicalObligations`. One idle cycle performs four byte captures and six scans. `replayKnowledgeConvergence` (`knowledge-convergence-replay.ts:21-74`) pages and JSON-parses the entire store three to four times per cycle (`owner.ts:55`, `:159`, `:232`, `:378`). There is no unchanged-state short-circuit; cost scales with repository and history size.
2. **Standing supervision pages the entire event store every cycle.** `apps/node-runtime/src/outcome-supervision-runtime.ts:108` wraps `withOwnerLease` (`:209`) and `readSnapshot` (`:226`) in `assertRequestBound()` → `findBoundSupervisionRequestEvent` (`supervision-request-presence.ts:8-39`), walking up to 100,000 events to find one `work.supervision.bound` event that cannot change after startup. The 5 s loop (`supervision-change-loop.ts:14`) continues at that interval whenever the report's `nextCheckAt` is in the past (`conversation-change-loop.ts:125`), as with a lineage whose progress deadline lapsed. `SupervisionAuthorityHistory.readVerified` (`supervision-authority-history.ts:90`) and `supervision-result-branch.ts:122` re-read the whole store every 60 s. `SQLiteEventStore.list` (`event-repository.ts:144-163`) has no type filter, so every walk parses all 60,168 payloads.
3. **The Mac replica coordinator polls four repositories every 30 s, re-hashing both working trees each time.** `~/.lervo/repository-replica-coordinator.json` sets `pollIntervalMs: 30000` and `peerWatch: false`; `repository-replica-watch.ts:33` reconciles every replica every 30 s regardless of changes. Each reconciliation runs a local snapshot, `ssh … wsl.exe … repository-replica snapshot` on the peer, and two receipts (`repository-replica-coordinator.ts:367-369`). `captureRepositoryReplicaSnapshot` (`repository-replica-git.ts:95-141`) copies the index, runs `read-tree HEAD` into it (discarding every stat-cache entry), then `git add -A`. Git therefore re-reads and re-hashes every file on every poll, although all replicas have been `current` for days. Windows also spawns `sshd`, `conhost`, `wsl.exe`, and `/init` per poll.

Verified non-causes: the 2,000 ms sync idle poll (Hub long-poll; Hub 0.2 %, plain Node mains 0.4–3 %), the 1 s event-watch fallback, Defender (2.3 %), Windows Search, Docker (idle), and the power plan, which follows the load. Argo is 16 % of the VM; this decision does not stop, throttle, or reschedule it.

## Decision

Resident Lervo services work only when something changes, observe each change once per cycle, read history incrementally through verified cursors, and back off idle reconciliation timers to a ceiling. Their caches are rebuildable private projections (invariant 4) and never claim currency (invariant 3).

### 1. Knowledge resident

- **Change fence:** Add `packages/repository-knowledge-runtime/src/source-fingerprint.ts` with `convergenceSourceFingerprint(storage)`: `sha256(canonicalJson({ head, status: sha256(git status --porcelain=v2 -z --untracked-files=all), index: {size, mtimeNs}, policy: hashes of the files convergenceSourceCaptureSettings reads, delegation: hash of CONVERGENCE_DELEGATION_PATH, candidates: sha256 of shard names and mtimes under .lervo/state/knowledge/*-candidates, eventsHead: events.latest()?.eventHash, outboxOutstanding for the convergence, repository and requeue destinations, earliestAvailableAt }))`. Expected cost: tens of milliseconds.
- **Skip rule:** In `startAutonomousKnowledgeWorker` (`loop.ts`), skip when the previous cycle returned `processed` with no outcomes, `convergence.state` is `idle | waiting_authority | attention_required | recovery_required`, and the fingerprint is unchanged. Heartbeat `idle` with reason `source_unchanged` and increment `idleStreak`. A due `earliestAvailableAt` always runs.
- **Adaptive reconciliation:** Replace `setInterval` (`loop.ts:106`) with a one-shot timer of `min(ceiling, base × 2^idleStreak, earliestAvailableAt − now)`, where `base = 60_000` and `ceiling = 900_000`. `schedule()` wakeups and non-idle results reset the streak. The ceiling cycle bypasses the fence, bounding undetected staleness to 15 minutes. Lift the `> 60_000` guard at `loop.ts:19` to the base.
- **Repository wakeups:** `apps/node-runtime/src/knowledge-worker-cli.ts:59` passes a composed `subscribe`: `watchProjectEventChanges` plus `watchRepositoryChanges(root)` (`repository-change-watch.ts`). Edits wake the resident instead of waiting for the timer.
- **One observation per cycle:** In `processKnowledgeConvergence`, compute `replayKnowledgeConvergence` once and pass its rows to `discover`, `resumeDependencies`, `reconcileKnowledgeConvergenceOutbox`, and `convergenceStatus`. Reuse the `discover()` baseline at `:378` if no stage ran. In `discoverConvergenceBaseline`, replace the second full capture (`baseline.ts:39`) with a before/after fingerprint comparison; give `inspectRepositoryKnowledgeCurrency` a `preparedScan` option. Compute `snapshotHash`, `policyHash`, and `debtDigest` exactly as today; event payloads do not change.
- **Content-hash cache:** `captureConvergenceSources` consults `.lervo/state/knowledge/source-hash-cache.sqlite`, keyed by `(path, size, mtimeNs, ino)`. Misses read, hash, and upsert; prune absent paths; bound the cache to 50,000 rows. Output bytes remain identical.
- **Host-wide cycle admission:** Take a host lock beside the provider admission directory (`provider-admission.ts`), concurrency 1, only for full cycles. Six residents on one host serialize their bursts.

### 2. Standing supervision

- `BoundSupervisionRequestPresence` in `supervision-request-presence.ts` performs a full startup scan with unchanged semantics, including throwing on conflicting origins. It then scans incrementally from a `{seq, eventHash}` cursor verified like `SupervisionAuthorityHistory`; anchor failure triggers a full scan.
- `readVerified` (`supervision-authority-history.ts:90`) retains the 60 s audit as anchor-and-tail verification, with a full re-read every 900 s or on anchor failure. The owner may retain the 60 s full re-read for security, at a floor of about 8 % of a core on the lervo main.
- `supervision-result-branch.ts:122` and `supervision-standing.ts:65` retain cursors using the same anchor rule.
- `ConversationChangeLoop` (`conversation-change-loop.ts:114-130`) gains `idleBackoff?: { baseMs, ceilingMs }`. When the deadline has passed and the cycle reports no change, delay doubles from `intervalMs` to the ceiling; `notify()` resets it. `createSupervisionChangeLoop` passes `{ baseMs: 5_000, ceilingMs: 300_000 }` and reports "no change" when `outcome-supervision-cursors.ts` leaves the digest and `blocked` state unchanged.
- `ListEventsOptions` (`packages/storage-contract`) gains `types?: readonly string[]`. `event-repository.ts:144` adds `AND type IN (…)` with an index on `(project_id, type, seq)`. `findBoundSupervisionRequestEvent`, `resolveStandingRoot`, `scanForStandingLineageChange`, and `replayKnowledgeConvergence` pass their types. This is additive: omitting `types` preserves today's behavior.

### 3. Replica coordinator

- `captureRepositoryReplicaSnapshot` first computes `sha256(canonicalJson({ head, branch, index: {size, mtimeNs}, status: sha256(git status --porcelain=v2 -z --untracked-files=all) }))` and compares it with `<git-dir>/lervo-replica/snapshot-cache.json`. A hit returns the cached snapshot without touching an index; a miss runs today's capture and rewrites the cache. Both sides share this function.
- In `watchReplicaReconciliation`, while every replica's last result is `current`, `recoveryIntervalMs` doubles up to new key `idleRecoveryCeilingMs` (default 600,000; validated range 30,000–3,600,000 in `repository-replica-config.ts`). A local hint or non-`current` result resets it to `pollIntervalMs`. The health snapshot adds `recoveryIntervalMs`.
- `RepositoryReplicaCoordinator.reconcile` skips the peer receipt when status is `current` and the receipt equals the last one written for that replica. Always write the local receipt.
- Owner-side (Mac): set `peerWatch: true` and `idleRecoveryCeilingMs`. `peerWatch` was deliberately disabled; the owner decides whether that reason still holds. Without it, caching and back-off alone remove about 90 % of the cost.

## Events, states and failure meaning

No new canonical event is introduced. New private, rebuildable state:

- `.lervo/state/knowledge/resident-cycle.json`: `{ schemaVersion: 1, fingerprint, lastCycleAt, lastResult: "idle" | "waiting" | "attention" | "processed", idleStreak, nextReconcileAt }`. Digests and timestamps only; missing or invalid state makes the next cycle full.
- Resident health reason `source_unchanged` uses the existing `reason` column (≤ 128 chars) with state `idle`. It proves the fence skipped work, never document currency.
- `.lervo/state/knowledge/source-hash-cache.sqlite`: `(path, size, mtime_ns, ino, sha256, kind)`. Paths already appear in baselines; corruption triggers deletion and rebuild.
- `<git-dir>/lervo-replica/snapshot-cache.json`: `{ schemaVersion: 1, fingerprint, snapshot }`. Hashes and branch name; never tracked; mismatch triggers full capture.
- Supervision presence cursor and loop back-off stay in memory; anchor failure triggers full rescan.
- `repository-replicas.health.json` gains informational `recoveryIntervalMs`.

## Host-level options (owner approval, separate from code)

- Argo uses 90 % of a core from an interactive shell (`init.scope`). Owner-only options, not planned here: a training window, a user unit with `CPUQuota`/`Nice`, or no change.
- Optional power-plan change: `powercfg /setacvalueindex SCHEME_CURRENT SUB_PROCESSOR PERFBOOSTMODE 0` (or 99 % maximum state) lowers temperature and fan speed at the cost of peak clocks.
- Lowering `.wslconfig processors=6` caps the VM but slows Argo and builds; not recommended.
- A Defender exclusion for the VHDX directory has marginal benefit: `MsMpEng` is 2.3 %.

## Consequences

Expected steady state, as percentages of one core: residents 233 → ≤ 12; mains 75 → ≤ 6; replica 63 → ≤ 4; Lervo 372 → ≤ 22; Argo 90 unchanged; VM 559 → ~115 of 600. The evidence document contains the table.

## Implementation plan

Each step requires unit tests, `pnpm quality:check`, `pnpm release:completion:check --base <rev>`, reviewed release intent per ADR-0221, deployment through `~/delivery/wbuild-<rev>.sh` and `~/delivery/nup-<rev>.sh`, then the evidence-document measurement. Rollback: re-point units at retained `~/.local/lib/lervo-node/runtime-<previous>-r1` and restart. For the Mac, restore coordinator JSON and run `launchctl kickstart -k gui/$UID/dev.lervo.repository-replica`.

1. Record a ten-minute baseline using the evidence method.
2. Implement Decision 1's first five bullets. Test back-off 60 s → 2 → 4 → 8 → 15 min and wakeup reset. Verify the fence is unchanged on an untouched tree and changes after an edit, untracked file, deletion, commit, policy edit, delegation edit, candidate shard change, new event, or outbox change. Fixtures assert one `discover` and one replay per idle cycle. Expected residents: 233 → ≤ 20.
3. Implement Decision 2. Test incremental presence equivalence to the full scan, including a late conflicting origin; back-off on a lapsed deadline and reset on notify; and `types` filter equivalence. Expected mains: 75 → ≤ 6.
4. Implement Decision 3. Test cached snapshot equivalence to fresh capture for an unchanged tree, modified tracked file, new untracked file, deleted file, moved HEAD, ignored file, and index-only staged change; test back-off and hint reset. Deploy the Mac bundle; the owner applies config. Expected replica cost: 63 → ≤ 4.
5. Implement Decision 1's last two bullets. Test byte-identical `sources` and `snapshotHash` on cache hits and misses, and that two residents never hold the full-cycle lock together. Expected resident cost: ≤ 12; lervo ceiling cycle: under 10 s.
6. Present host-level options with the post-fix measurement.

## Acceptance

Measure read-only using the evidence method:

- VM busy < 25 % over five minutes with Argo running.
- Each `knowledge-worker` < 3 % averaged over ten minutes and 0 % between cycles, with `source_unchanged` heartbeats.
- Each standing main < 5 %, reading under 10 MB/min from `events.sqlite`.
- ≤ 1 `repository-replica snapshot` per replica per 10 minutes while Mac trees are unchanged, with `recoveryIntervalMs` at the ceiling.
- `% Processor Performance` ≤ 100 % and `vmmemWSL` < 150 % of one logical processor over five minutes.
- Owner-recorded temperature and fan speed below baseline.

Negative checks: a tracked-file edit wakes the resident within 2 s and the next cycle runs in full; a Mac commit reconciles within one poll; a lapsed supervision deadline still re-evaluates within 300 s. `lervo knowledge lint` and the convergence and replica suites must pass.

## Deferred

A host-level scheduler across Node units, one resident per host, and per-path incremental baselines.

## References

- [Repository knowledge compilation](../../../specs/repository-knowledge-compilation.md)
- [ADR-0221 reviewed CLI release preparation](../../release/packaging/0221-reviewed-cli-release-preparation.md)
