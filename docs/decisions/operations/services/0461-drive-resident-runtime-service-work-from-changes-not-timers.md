# ADR-0461: Drive resident runtime service work from changes, not timers

Status: `accepted`
Decision date: 2026-10-05
Amends: [ADR-0433](../../knowledge/repository/canonicalization/0433-own-background-knowledge-for-every-repository-change.md), [ADR-0399](../../coordination/sync/0399-change-driven-repository-and-conversation-work.md), [ADR-0628](../../coordination/sync/0628-bounded-replica-transport-and-service-completion.md), [ADR-0458](../../execution/orchestration/improvement/0458-learn-from-single-observations-and-run-standing-autonomy.md)
Related: [ADR-0164](0164-user-runtime-service-management-boundary.md), [ADR-0165](0165-runtime-readiness-and-preflight-boundary.md), [ADR-0450](../../knowledge/repository/canonicalization/0450-keep-background-knowledge-out-of-developer-flow.md)
Evidence: [Hub host load measurement, 2026-10-05](../../../evidence/operations/hub-host-load-2026-10-05.md)

## Context

The idle Hub host (Windows, Ryzen 5 7500F 6c/12t, WSL2 with six vCPUs) runs at ≥ 60 °C, ≥ 4,000 MHz and ≥ 2,000 RPM. Read-only measurements on 2026-10-05, after deployment `25d1abc9` settled, found the following; methods and full tables are in the evidence document.

- Windows: `vmmemWSL` used 547 % of one logical processor, `System` 32 %, and everything else < 3 %. The Balanced power plan had boost engaged (`% Processor Performance` 132 %). The VM causes the heat.
- WSL over 60 s: 559 % of one core busy (90 % of six vCPUs). Six `knowledge-worker` residents used 233 %; six Node service mains 75 % (70 % from the two standing-supervision mains); short-lived `repository-replica snapshot`/`receipt` processes from the Mac coordinator 63 % (23 per minute); protected Argo 90 %; Hub 0.3 %. Lervo used ≈ 372 % of one core, 62 % of the VM and ~31 % of the machine, although event stores recorded no knowledge work (lervo's last event was 15 h old).
- The lervo Node systemd unit reported `Consumed 1h 3min 19s CPU time over 51min 39s wall clock`.
- Each resident produces a single-threaded 100 % burst every 60 s, lasting 11–44 s and reading 146 MB–2.6 GB per 45 s. The lervo cycle exceeds 60 s and never pauses. Standing mains reopen and read `events.sqlite` at 25 MB/s: a full 108 MB pass every 4–5 s.

### Root causes, verified in source

1. **Knowledge residents re-verify the repository and replay its entire event log on a fixed 60 s timer, even without changes.** `packages/repository-knowledge-runtime/src/loop.ts:106` runs `setInterval(cycle, 60_000)` alongside event wakeups. Each cycle (`worker.ts:66-103`) calls `processKnowledgeConvergence`, which calls `host.discover()` at startup (`knowledge-convergence-owner.ts:54`) and for final status (`:378`). Each discovery (`baseline.ts:20-139`) runs:
   - One `scanConfiguredRepositoryKnowledge`.
   - Two full `captureConvergenceSources` (`:30`, `:39`), using `readFileSync` and SHA-256 for every tracked and untracked file (`source-capture.ts:84-104`; 6,914 files in lervo).
   - Two `captureConvergenceChangedPaths`, `inspectConfiguredDocumentNormalization`, and `inspectRepositoryKnowledgeCurrency` (two more scans, five plan builders and a lint; `knowledge-currency.ts:30-66`).
   - `listCanonicalizationCandidates` (readdir across 472 shard directories) and `historicalObligations`.

   An idle cycle performs four byte captures and six scans. `replayKnowledgeConvergence` (`knowledge-convergence-replay.ts:21-74`) pages and JSON-parses the whole store three to four times per cycle (`owner.ts:55`, `:159`, `:232`, `:378`). Nothing short-circuits unchanged input; cost scales with repository and history size.

2. **Standing supervision pages the entire event store every cycle.** `apps/node-runtime/src/outcome-supervision-runtime.ts:108` wraps `withOwnerLease` (`:209`) and `readSnapshot` (`:226`) in `assertRequestBound()` → `findBoundSupervisionRequestEvent` (`supervision-request-presence.ts:8-39`). This walks up to 100,000 events to find one `work.supervision.bound` event that cannot change after startup. The 5 s loop (`supervision-change-loop.ts:14`) keeps that interval whenever the report's `nextCheckAt` is past (`conversation-change-loop.ts:125`), as with a lineage whose progress deadline lapsed. `SupervisionAuthorityHistory.readVerified` (`supervision-authority-history.ts:90`) and `supervision-result-branch.ts:122` re-read the whole store every 60 s. `SQLiteEventStore.list` (`event-repository.ts:144-163`) lacks a type filter, so each walk parses all 60,168 payloads.

3. **The Mac replica coordinator polls four repositories every 30 s, re-hashing both working trees each time.** `~/.lervo/repository-replica-coordinator.json` sets `pollIntervalMs: 30000` and `peerWatch: false`; `repository-replica-watch.ts:33` reconciles every replica every 30 s regardless of change. Each reconciliation runs a local snapshot, `ssh … wsl.exe … repository-replica snapshot` on the peer, and two receipts (`repository-replica-coordinator.ts:367-369`). `captureRepositoryReplicaSnapshot` (`repository-replica-git.ts:95-141`) copies the index, runs `read-tree HEAD` into it (discarding every stat-cache entry), then `git add -A`. Git re-reads and re-hashes every file on every poll despite all replicas being `current` for days. Windows also spawns `sshd`, `conhost`, `wsl.exe` and `/init` per poll.

Verified non-causes: the 2,000 ms sync idle poll (Hub long-poll; Hub 0.2 %, plain Node mains 0.4–3 %), the 1 s event-watch fallback, Defender (2.3 %), Windows Search, idle Docker, and the power plan, which follows load. Argo uses 16 % of the VM; this decision does not stop, throttle or reschedule it.

## Decision

Resident Lervo services work only when something changes, observe each change once per cycle, read history incrementally through verified cursors, and back reconciliation timers off to an idle ceiling. Caches are rebuildable private projections (invariant 4); they never claim currency (invariant 3).

### 1. Knowledge resident

- **Change fence:** Add `packages/repository-knowledge-runtime/src/source-fingerprint.ts` with `convergenceSourceFingerprint(storage)`: `sha256(canonicalJson({ head, status: sha256(git status --porcelain=v2 -z --untracked-files=all), index: {size, mtimeNs}, policy: hashes of the files convergenceSourceCaptureSettings reads, delegation: hash of CONVERGENCE_DELEGATION_PATH, candidates: sha256 of shard names and mtimes under .lervo/state/knowledge/*-candidates, eventsHead: events.latest()?.eventHash, outboxOutstanding for the convergence, repository and requeue destinations, earliestAvailableAt }))`. Expected cost: tens of milliseconds.
- **Skip rule:** In `startAutonomousKnowledgeWorker` (`loop.ts`), skip when the previous cycle returned `processed` with no outcomes, `convergence.state` is `idle | waiting_authority | attention_required | recovery_required`, and the fingerprint is unchanged. Heartbeat `idle` with reason `source_unchanged` and increment `idleStreak`. A due `earliestAvailableAt` always runs.
- **Adaptive reconciliation:** Replace `setInterval` (`loop.ts:106`) with a one-shot timer of `min(ceiling, base × 2^idleStreak, earliestAvailableAt − now)`, where `base = 60_000` and `ceiling = 900_000`. `schedule()` wakeups and non-idle results reset the streak. The ceiling cycle bypasses the fence, bounding undetected staleness to 15 minutes. Lift the `> 60_000` guard at `loop.ts:19` to the base.
- **Repository wakeups:** `apps/node-runtime/src/knowledge-worker-cli.ts:59` passes a composed `subscribe`: `watchProjectEventChanges` plus `watchRepositoryChanges(root)` (`repository-change-watch.ts`). Edits wake the resident.
- **One observation per cycle:** In `processKnowledgeConvergence`, compute `replayKnowledgeConvergence` once and pass rows to `discover`, `resumeDependencies`, `reconcileKnowledgeConvergenceOutbox` and `convergenceStatus`. Reuse the `discover()` baseline at `:378` when no stage ran. In `discoverConvergenceBaseline`, replace the second full capture (`baseline.ts:39`) with a before/after fingerprint comparison; add a `preparedScan` option to `inspectRepositoryKnowledgeCurrency`. Preserve existing `snapshotHash`, `policyHash` and `debtDigest` computations and event payloads.
- **Content-hash cache:** `captureConvergenceSources` consults `.lervo/state/knowledge/source-hash-cache.sqlite`, keyed by `(path, size, mtimeNs, ino)`. Misses read, hash and upsert; prune absent paths; bound the cache to 50,000 rows. Output bytes remain identical.
- **Host-wide cycle admission:** Use a host lock beside the provider admission directory (`provider-admission.ts`), with concurrency 1, taken only for full cycles. Six residents on one host serialize bursts.

### 2. Standing supervision

- `BoundSupervisionRequestPresence` in `supervision-request-presence.ts` performs a full startup scan with unchanged semantics: conflicting origins still throw. Subsequent scans are incremental from a `{seq, eventHash}` cursor verified like `SupervisionAuthorityHistory`; anchor failure triggers a full scan.
- `readVerified` (`supervision-authority-history.ts:90`) retains the 60 s audit as anchor-and-tail verification, with a full re-read every 900 s or on anchor failure. The owner may retain the 60 s full re-read for security, at a floor of about 8 % of a core on the lervo main.
- `supervision-result-branch.ts:122` and `supervision-standing.ts:65` retain cursors with the same anchor rule.
- Add `idleBackoff?: { baseMs, ceilingMs }` to `ConversationChangeLoop` (`conversation-change-loop.ts:114-130`). When the deadline has passed and a cycle reports no change, double the delay from `intervalMs` to the ceiling; `notify()` resets it. `createSupervisionChangeLoop` passes `{ baseMs: 5_000, ceilingMs: 300_000 }` and reports "no change" when `outcome-supervision-cursors.ts` leaves both the digest and `blocked` state unchanged.
- Add `types?: readonly string[]` to `ListEventsOptions` (`packages/storage-contract`). `event-repository.ts:144` adds `AND type IN (…)` and an index on `(project_id, type, seq)`. `findBoundSupervisionRequestEvent`, `resolveStandingRoot`, `scanForStandingLineageChange` and `replayKnowledgeConvergence` pass their types. This is additive: omitting `types` preserves current behavior.

### 3. Replica coordinator

- `captureRepositoryReplicaSnapshot` first computes `sha256(canonicalJson({ head, branch, index: {size, mtimeNs}, status: sha256(git status --porcelain=v2 -z --untracked-files=all) }))` and compares it with `<git-dir>/lervo-replica/snapshot-cache.json`. A hit returns the cached snapshot without touching an index; a miss runs the existing capture and rewrites the cache. Both sides share this function.
- In `watchReplicaReconciliation`, while every replica's last result is `current`, double `recoveryIntervalMs` up to new key `idleRecoveryCeilingMs` (default 600,000; validated range 30,000–3,600,000 in `repository-replica-config.ts`). A local hint or non-`current` result resets it to `pollIntervalMs`. Add `recoveryIntervalMs` to the health snapshot.
- `RepositoryReplicaCoordinator.reconcile` skips the peer receipt when status is `current` and the receipt equals the last one written for that replica. Always write the local receipt.
- Owner-side (Mac): set `peerWatch: true` and `idleRecoveryCeilingMs`. `peerWatch` was deliberately disabled; the owner decides whether that reason still holds. Without it, caching and back-off alone remove about 90 % of the cost.

## Events, states and failure meaning

No new canonical event. New state is private and rebuildable:

- `.lervo/state/knowledge/resident-cycle.json`: `{ schemaVersion: 1, fingerprint, lastCycleAt, lastResult: "idle" | "waiting" | "attention" | "processed", idleStreak, nextReconcileAt }`. Digests and timestamps only; missing or invalid state forces a full next cycle.
- Resident health reason `source_unchanged`, in the existing `reason` column (≤ 128 chars), with state `idle`: proves the fence skipped work, never document currency.
- `.lervo/state/knowledge/source-hash-cache.sqlite`: `(path, size, mtime_ns, ino, sha256, kind)`. Paths already appear in baselines; delete and rebuild on corruption.
- `<git-dir>/lervo-replica/snapshot-cache.json`: `{ schemaVersion: 1, fingerprint, snapshot }`. Contains hashes and branch name; never tracked; mismatch triggers full capture.
- Supervision presence cursor and loop back-off stay in memory; anchor failure triggers full rescan.
- `repository-replicas.health.json` gains informational `recoveryIntervalMs`.

## Host-level options (owner approval, separate from code)

- Argo uses 90 % of a core from an interactive shell (`init.scope`). Owner-only options, not planned here: a training window, a user unit with `CPUQuota`/`Nice`, or no change.
- Optional power-plan change: `powercfg /setacvalueindex SCHEME_CURRENT SUB_PROCESSOR PERFBOOSTMODE 0` (or 99 % maximum state) lowers temperature and fan speed at the cost of peak clocks.
- Lowering `.wslconfig processors=6` caps the VM but slows Argo and builds; not recommended.
- Defender exclusion for the VHDX directory offers marginal benefit: `MsMpEng` is 2.3 %.

Expected steady state, as percentages of one core: residents 233 → ≤ 12; mains 75 → ≤ 6; replica 63 → ≤ 4; Lervo 372 → ≤ 22; Argo unchanged at 90; VM 559 → ~115 of 600. See the evidence table.

## Implementation plan

For each step: unit tests, `pnpm quality:check`, `pnpm release:completion:check --base <rev>`, reviewed release intent per ADR-0221, deployment through `~/delivery/wbuild-<rev>.sh` and `~/delivery/nup-<rev>.sh`, then measurement using the evidence document.

Rollback: re-point units at retained `~/.local/lib/lervo-node/runtime-<previous>-r1` and restart. On the Mac, restore coordinator JSON and run `launchctl kickstart -k gui/$UID/dev.lervo.repository-replica`.

1. Record a ten-minute baseline using the evidence method.
2. Implement Decision 1's first five bullets. Test back-off 60 s → 2 → 4 → 8 → 15 min and wakeup reset. Test that the fence stays unchanged on an untouched tree and changes after an edit, untracked file, delete, commit, policy edit, delegation edit, candidate shard change, new event or outbox change. Fixtures assert one `discover` and one replay per idle cycle. Expected residents: 233 → ≤ 20.
3. Implement Decision 2. Test incremental presence against the full scan, including a late conflicting origin; back-off on a lapsed deadline and reset on notify; and `types` filter equivalence. Expected mains: 75 → ≤ 6.
4. Implement Decision 3. Test cached snapshots against fresh capture for an unchanged tree, modified tracked file, new untracked file, deleted file, moved HEAD, ignored file and index-only staged change; test back-off and hint reset. Deploy the Mac bundle; the owner applies configuration. Expected replica cost: 63 → ≤ 4.
5. Implement Decision 1's last two bullets. Test cache hits and misses for byte-identical `sources` and `snapshotHash`; verify two residents never hold the full-cycle lock together. Expected residents: ≤ 12, with the lervo ceiling cycle under 10 s.
6. Present host-level options with post-fix measurements.

## Acceptance

Use read-only measurements with the evidence method:

- VM busy < 25 % over five minutes with Argo running.
- Each `knowledge-worker` averages < 3 % over ten minutes and uses 0 % between cycles, with `source_unchanged` heartbeats.
- Each standing main uses < 5 % and reads under 10 MB/min from `events.sqlite`.
- ≤ 1 `repository-replica snapshot` per replica per 10 minutes while Mac trees are unchanged, with `recoveryIntervalMs` at the ceiling.
- `% Processor Performance` ≤ 100 % and `vmmemWSL` < 150 % of one logical processor over five minutes.
- Owner-recorded temperature and fan speed below baseline.

Negative checks: a tracked-file edit wakes the resident within 2 s and the next cycle runs in full; a Mac commit reconciles within one poll; a lapsed supervision deadline still re-evaluates within 300 s; `lervo knowledge lint` and the convergence and replica suites pass.

## Deferred

A host-level scheduler across Node units, one resident per host, and per-path incremental baselines.

## References

- [Repository knowledge compilation](../../../specs/repository-knowledge-compilation.md)
- [ADR-0221 reviewed CLI release preparation](../../release/packaging/0221-reviewed-cli-release-preparation.md)
