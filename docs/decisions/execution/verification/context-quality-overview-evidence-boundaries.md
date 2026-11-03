# Context-quality overview evidence-boundary amendment

Status: `documentary_reconciliation; qualification_incomplete`

This document amends the interpretation of the **Current candidate**, **Current recording cost**, and **Retention and organization** sections in the [context-quality evidence overview](../../../evidence/quality/context-quality/overview.md). It reconciles the exact documentary sources supplied for this assessment. It does not select a runtime, approve a release, or supply new execution evidence.

Where the overview's current wording combines different artifacts or presents historical directory counts as current, this amendment governs. The original overview and responsibility-specific records remain preserved as historical evidence. Their test counts, artifact identities and measured outcomes are not pooled or transferred to later builds.

## Artifact-specific qualification

The supplied record contains several distinct boundaries. There is no single artifact qualified by all the overview's success statements.

| Boundary                                  | Exact identity and supported interpretation                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Earlier host-admission build              | Runtime `sha256:64ad6db621441b68b10be2f391804af7d19fe569238e4443423035821a747118`. The source-verification and target-platform records report 5,962 passing regression tests, eight skipped live tests, seven Darwin arm64 consumer commands and isolated Linux/Windows checks for this build. These results do not qualify later recording artifacts.                                                                                                                                                                    |
| Duplicate-compression lifecycle artifacts | CLI archive `adb91c013d1aab295f262be97a479b649a5b2ab385c6d4320d7ae28e89c6c192`, runtime aggregate `7b0ce832352017352f85fd29c8909e5146d346b6bbc8e928c86a4b90b906650a`; standalone Node archive `7e73c79402d5a5348a4add22345730de4f6668e6c40c8677264b9f05dfd62afb`, aggregate `27cbd7da6a0c2900a9569752e644b3581acb6ac25ec7b1049e1bddd7179d48ae`. The installed recovery record reports 96 process-interruption/retry cases and twelve quota cases on Darwin arm64 across Node 22.13.0 and 26.5.1.                          |
| Statement-reuse artifact                  | Runtime aggregate `sha256:c33e39c4245e01444a8783ccce5a3ed634bc278c3d8cfdb36785144677008036`; CLI archive `sha256:7ad73081dabf3259477612b5d1640d02e47365238ed5bbfeb3154e56a98bdf5a`; paired Node archive `sha256:06cf5f6b30a2cd699808ccfdccbeed664a05223567a0ae4d303105fbdae6d97d`. Its thirty-cold-pair v3 cohorts report 7/8 groups on Node 26.5.1 and 6/8 on Node 22.13.0. Neither is a complete performance pass.                                                                                                      |
| Later point-of-use verification artifact  | CLI graph `sha256:e8ad3b1c8a33b47f62a3117c029d1908c315c60e99817d2341689b95832183af`; CLI archive `sha256:96c0a9eb2badc4b93ffa72fa7a48fe7ad8db56647da9a72a463ee49096a486e9`; Node archive `sha256:793c6fcf37139acbf1955f87ff86f59cffe74176241ddbbf7fcbbd69bf1bae9e`. Its reported lifecycle observations, incomplete full-suite result and loaded-host resource observations are separate from the statement-reuse qualification. The supplied context does not identify a Node runtime aggregate for this later boundary. |

The [installed recovery record](../../../evidence/quality/context-quality/installed-report-recovery.md) reports 66,064 stored-body audits totaling **539,370,741 decoded bytes** for the duplicate-compression quota fixtures. The [commit-allowance record](../../../evidence/quality/context-quality/installed-commit-allowance-qualification.md) reports **539,370,744 decoded bytes** for the separate statement-reuse checks. These totals belong to different recorded fixture populations. Neither is substituted for the other or assigned to the later point-of-use artifact.

## Resource results retain their protocol identities

[ADR-0506](0506-separate-platform-commit-cost-from-recording-gates.md) already corrects the delivery roadmap's v2 label: the paired 7/8 and 6/8 summary means **v3 statement-reuse cohorts**, each with thirty cold pairs and 480 workers.

- Historical frozen v1 remains failed at 3/8 for its recorded artifact and protocol.
- Under v2 on Node 26.5.1, the duplicate-compression artifact reports 5/8 and the statement-reuse artifact reports 7/8. The latter fails the 12 KiB cold CPU bound at 1.266. These five-cold-pair observations remain retained.
- Under v3, statement reuse reports 7/8 on Node 26.5.1, with 12 KiB cold CPU at 1.254. Node 22.13.0 reports 6/8, with 12 KiB cold latency at 11.706 ms and 4 KiB concurrent process and CPU bounds at 1.216 and 1.292. Host load and split publication are observations, not grounds to discard failures.
- The initial Node 22.13.0 v3 run overlapped agent profiling and microbenchmarks. Result `1b9c67ee09b928ae72204d506b4279c601b9d48406ca4ee419710c7219414f3b` remains an invalid protocol observation and is not pooled into the replacement cohort.

The valid statement-reuse v3 result digests are `8c88b74a68e0ba0996a2533ecbf1517d1cb4777456283b276afe4f2a462dac33` for Node 26.5.1 and `6c90f31a7a442cdb4560b234e02a89302b420d61e90dde726bb07949f0249bfb` for Node 22.13.0.

The later point-of-use cohorts report passing CPU groups under heavier unrelated host load, with largest CPU upper bounds of 1.225 and 1.244. Latency intervals widened and split publications increased to 71 of 480 recording workers: 17 on Node 26.5.1 and 54 on Node 22.13.0. The record explicitly does not count these observations as performance qualification. Their result digests are `259ebbc4e90c350cd92dc639fae9722df0b638cb4970c83386938b59a7efb5a7` and `68272c9ebc3c6825c5122e2ff229f403ab3a6f8321ce99c1d67089c8038566e5`.

Thus neither the earlier 7/8 and 6/8 results nor the older host-admission test pass qualifies the changed point-of-use graph. Historical statements that all CPU groups remained open describe their particular earlier measurements; they are not the latest reported CPU observations. Conversely, the later reported CPU passes do not establish complete resource acceptance.

## Later source and lifecycle limitations

The point-of-use section of the commit-allowance record reports **6,149 passes out of 6,160 tests, eight skips and three failures**. A cleanup race passed when rerun alone. The other two failures were attributed in the original account to a launcher field added by an earlier Node upgrade, but no comparative baseline or failing-before observation is supplied. Their alleged pre-existing status is unverified. Both remain unresolved, and the full suite is not a complete pass.

The same record reports twelve passing capacity cases for this later artifact. Its crash harness initially failed on both Node versions because it required both cold events in the first commit. The revised harness permits one through the maximum number of events before a receipt, while still requiring every event at receipt, consistent with the documented fifty-millisecond backstop. With that change, all 96 crash cases pass in the report, nine with split groups; administrative inspection reports 96 passes. The previous artifact still passed the stricter harness. These are distinct observations with an explicit harness change, not identical-protocol evidence of nonregression or proof that the initial failures never occurred.

[ADR-0507](0507-verify-event-history-at-the-point-of-use.md) supplies the current verification contract: store binding at opening and before writes, returned-row and append-predecessor checks at use, and explicit complete-history verification. Its amendment supersedes older automatic complete-history requirements in the storage-reuse specification. Fresh writer and filesystem checks, report-selection fences, transaction failure behavior, strong synchronization and both complete report reads remain required. Historical evidence retains the algorithms it measured.

## Directory inventory correction

The overview's statement that the collection has twenty stage records plus the overview, and its following parent/directory counts of fourteen and twenty-one, describe the earlier organization checkpoint. They are not current inventory assertions.

The supplied layout observation reports **25 direct documents** in `docs/evidence/quality/context-quality` and **15 direct documents** in its parent `docs/evidence/quality`. It reports 1,738 repository documents before this draft. This amendment adds one document under `docs/decisions/execution/verification`, leaving both evidence-directory counts unchanged and making the repository total 1,739 if applied to that exact inventory.

The verification directory has eighteen observed direct documents before this addition and nineteen afterward, within the layout's twenty-four-document leaf limit and thirty-two-document direct capacity. No new child directory is introduced. The catalog-specific capacity override does not apply here.

The earlier lint warning count, migration operation count, link checks and quality checks remain historical organization observations. They have not been rerun by this assessment. Counts alone do not establish content completeness, lifecycle currency or semantic coverage. Continue updating responsibility-specific records rather than creating a document for every run.

## Documentary evidence boundary and remaining acceptance

The native implementation record at `docs/evidence/quality/context-quality/context-quality-native-sync-implementation.md` was unavailable with `document_read_failed`. Its linked sections were not inspected. References to that record in the overview are preserved, but neither its contents nor implementation conformance can be certified from those references.

This reconciliation uses supplied document bytes and the supplied layout inventory. It does not independently inspect temporary result files, archives, databases, private packets, source implementations or execution receipts. Descriptions of independent audits in the source records remain **reported audits**, not new audits performed here. No missing history is treated as proof that a failure predates a change.

Complete performance qualification, resolution of the two suite failures, owner-authorized retention, power-loss behavior, supported-platform qualification, reviewed real-task quality, actual provider and Discord journeys, and operational observation retain their separate requirements. Historical private-packet expiry obligations are unchanged; no cleanup completion or retention extension is inferred. No release publication, fleet deployment or production writer activation follows from this amendment.
