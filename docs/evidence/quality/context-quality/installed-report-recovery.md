# Installed report-storage lifecycle evidence

Status: `partial`
As of: 2026-10-12

This record covers process interruption, exact retry and capacity rejection for the current internal CLI/Node report-storage module. It supports the recovery requirements in [recording storage reuse](../../../specifications/execution/context-quality/recording-storage-reuse.md). Performance, owner-authorized retention operations, power-loss behavior and other supported platforms remain open.

The [duplicate compression change](installed-compiler-function-cost.md#duplicate-compression-removal) now has new packed installations and fresh recovery and capacity checks. Both installed runtime graphs match the previously measured scratch graphs exactly. These lifecycle results do not change the failed resource result.

## Artifact and execution scope

The canonical packer produced a CLI npm archive, which was installed into a temporary consumer with its production dependencies. The standalone Node builder, verifier and installer produced a second temporary installation. Native CLI assets passed their verifier and smoke check; the standalone installer verified its complete archive. Neither installation enabled a service or changed a global CLI.

| Artifact        | Archive SHA-256                                                    | Runtime aggregate SHA-256                                          |
| --------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| CLI             | `adb91c013d1aab295f262be97a479b649a5b2ab385c6d4320d7ae28e89c6c192` | `7b0ce832352017352f85fd29c8909e5146d346b6bbc8e928c86a4b90b906650a` |
| Standalone Node | `7e73c79402d5a5348a4add22345730de4f6668e6c40c8677264b9f05dfd62afb` | `27cbd7da6a0c2900a9569752e644b3581acb6ac25ec7b1049e1bddd7179d48ae` |

Each installed runtime contains the main ESM member, complete canonical CJS validator fallback and aggregate manifest. Its files match the current source build before and after the checks. Archive identities and runtime aggregate identities serve different purposes; neither is replaced by the entrypoint hash alone.

A fresh 96-case rerun covers both current installed duplicate-compression artifacts on Darwin arm64 with Node 22.13.0 and 26.5.1. Each combination tests 4 KiB and 12 KiB profiles, cold and concurrent observations, an empty store and a two-event store with one pending outbox entry, and three interruption boundaries. Production format 4 is selected through the existing plan/apply contract using synthetic reader evidence. This is fixture activation, not production reader admission.

## Interruption and retry results

The child captures its transaction observation synchronously, then sends `SIGKILL` to its own PID. The parent requires the signal exit and no normal exit code. Reopening and retry happen in a separate process using the installed module.

| Boundary                                               | Cases | Required and observed result                                                                                                                                                        |
| ------------------------------------------------------ | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before the first report COMMIT                         |    32 | The staged reports, chunks and events are absent after recovery; prior records and pending outbox state remain exact. Replaying the captured draft and body inserts the event once. |
| Immediately after that COMMIT, before readback/receipt |    32 | Reports and events recover together despite the missing success receipt. Exact replay retains their bytes and returns existing events without duplicates.                           |
| After every operation receipt                          |    32 | All acknowledged events and reports survive process termination. Exact replay of the complete operation history creates no duplicate event.                                         |

Before/after-COMMIT observations directly verify synchronous `FULL` (2), `fullfsync` (1) and `checkpoint_fullfsync` (1) on the writing connection. The after-receipt marker opens a separate read-only connection; its connection settings are not presented as writer settings. Every completed cold operation retains two complete body reads per report; every completed concurrent operation retains them across all warmups and samples. Processes killed before readback correctly have only their pre-commit reads. The retained crash observations contain 2,176 complete reads in total.

Recovery compares every event column, report header, encoded chunk and pending outbox row with the expected before/after state. Exact retries preserve original identifiers, timestamps, payloads and report bytes. Retry batches stay within eight reports and the existing sixteen-call transaction limit. All 1,248 replayed event drafts have the expected inserted/existing disposition.

Across the 96 independent fixtures, the first reopen observes 1,184 events; exact retry brings the total to 1,344. There are 3,872 complete decoded body/hash/JSON audits across recovery, replay and another ordinary close/reopen. The 48 fixtures with history retain their pending outbox entry. These totals count observations across independent fixtures, not one production event stream.

After ordinary close, all 96 stores have no WAL, shared-memory or rollback-journal sidecar. The existing repository-package administrative inspector accepts every store as format 4, reports the exact event count and chain head, and requires no schema migration. Before/after database hashes prove that inspection did not change source bytes. This administrative check is separate from the installed module's recovery behavior.

## Installed capacity results

Twelve fresh capacity cases exercise these same current installations on Node 22.13.0 and 26.5.1 through their actual report-writer ports. Each artifact/runtime pair independently reaches 16,384 reports, 67,108,864 decoded bytes and 67,108,864 encoded bytes. The byte-limit cases retain room under the other byte limit. Filler bodies are valid opaque storage objects, not semantic quality-report JSON. The initial two referenced reports come from an actual quality operation, and each fixture retains one pending outbox entry.

All fills use public transactions with at most sixteen reports; there are no raw SQL fixture inserts. In each case, a transaction stages a valid report and its event before a second report exceeds capacity. Both an uncaught failure and a callback-caught failure roll back the complete transaction. Full logical hashes preserve every event, outbox row, report header and encoded chunk. A subsequent valid report reaches the limit exactly, and another new report is rejected. Repeating an existing referenced report and event remains idempotent at capacity.

Ordinary preparation and scoped observation each retain a usable plan while recording returns `unavailable`. No partial event, report or outbox change survives. Actual-port reads audit all 66,064 stored bodies, totaling 539,370,741 decoded bytes across the twelve independent fixtures. Ordinary close/reopen preserves chain validity and referenced bodies. Independent read-only SQLite checks verify format 4, database integrity, every bounded chunk, decompressed body length/hash and the complete logical row digest. No CAS file remains in these fixtures; this does not assert that no transient file syscall occurred.

The capacity receipt is `/tmp/lervo-dedupe-capacity-independent.json`, SHA-256 `42b09fbf1b4726a05ad07e149397bd15bfcb58ec339a1c20ab41de193636bf0a`. It binds the twelve raw results, installed runtime files and final databases, and confirms all 165 post-build source/output hashes were unchanged. Totals include 24 atomic rejections, twelve direct overflow rejections, twelve duplicate retries, 24 unavailable recording outcomes, 24 preserved events and twelve preserved outbox entries. These are lifecycle checks, not performance samples or retention operations.

The corrected capacity observer explicitly retains each SQLite statement for its iterator lifetime on both Node versions. All twelve current cases pass without a worker retry. The earlier launcher, iterator-lifetime and verifier failures remain recorded in `/tmp/lervo-installed-capacity-independent.json`, SHA-256 `e584db3b99099234d04068f20573859a1ec1f34b08afe2b1027283ff6a6cd592`. That historical receipt is not reused as evidence for these new installations.

## Evidence and limits

The current installation root ends in `lervo-dedupe-installed-w7q1Ei`; recovery cases use separate fresh fixtures. Raw child observations, signal outcomes, retry results, archive descriptors, installed inventories and final database hashes are bound by `/tmp/lervo-dedupe-recovery-independent.json`, SHA-256 `0c2634087b9f9d9ebfa5c37e41f5921dea7c18442b2d49d779203963cd593d7b`. The verifier independently decompresses every captured report, recomputes body hashes and reconciles all counts. It confirms 165 post-build source/output paths remained unchanged before this documentation update and independently checks every final SQLite body. Both recovery and capacity receipts bind the new installed artifacts; every fixture is fresh.

The preceding recovery harness initially failed because SQLite returns rows with a null prototype while the captured JSON contains ordinary objects. The corrected harness compares normalized JSON values, preserving every column and byte. The original script, failed audit, captured transaction and partially replayed fixture remain available. That was an assertion representation error, not a product repair. The current 96 cases use the corrected harness and fresh fixtures; no resource observation is rerun. The preceding recovery receipt remains `/tmp/lervo-installed-recovery-independent.json`, SHA-256 `f4883691f2b1623a99f6904fb69c3790909a8b727f55342e8f714255f0b776de`.

These checks prove the tested process-crash boundaries on Darwin arm64. They do not simulate power loss, a filesystem/device failure, interruption inside SQLite's COMMIT implementation, or Linux/Windows behavior. The capacity checks exercise quota exhaustion; owner-authorized retention remains unimplemented and unqualified. No production deployment, external message, release publication or private-review expiry change occurred.

The [current resource result](context-quality-native-sync-implementation.md#current-first-use-costs-and-source-compilation-hints) remains failed. Recovery success cannot satisfy the frozen latency, CPU, process, RSS or storage gates. Next continue a distinct recording-cost repair and resolve the bounded owner-retention contract separately. Performance repair remains required.
