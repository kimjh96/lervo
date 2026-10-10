# Context-quality evidence

Status: `partial`
As of: 2026-10-11

This collection records implementation and evaluation of [ADR-0501](../../../decisions/execution/grounding/0501-share-context-quality-contracts-across-product-surfaces.md) and [ADR-0502](../../../decisions/distribution/0502-bind-native-sync-assets-to-standalone-runtime-distributions.md). The [delivery roadmap](../../../roadmap/natural-language-grounding-quality/context-quality-parity.md) defines the remaining acceptance requirements. Historical documents describe their measured source revision and stage; their status lines do not describe the current release.

## Current candidate

The [consolidated source review](context-quality-source-verification.md#current-consolidated-review) now covers all 225 production and repository-script files in its initial inventory, including one removed unused terminal loader. Current production-diff reconciliation finds no omitted implementation file. Thirteen changed configuration and workflow files and one additional release-impact classifier have also been reviewed. The review also covers 63 changed Markdown files and 60 frozen JSON evidence/protocol files. The final review also covers all 107 changed test/fixture source files and reconciles all 506 PR paths. That baseline review supports its source, retention and privacy attestations. The SQLite correction below adds eleven reviewed production paths, four test paths and one release intent, bringing the current diff to 522 paths. Release verification remains open.

The review repaired task-verdict rebinding, instruction exclusion through an ineligible rule, writer activation using changed plan bytes, caller mutation of durable knowledge operations and terminal cache persistence. The transfer correction binds native transfer publication to the exact pair digest in its receipt. Two file-mutation cases failed before the fix; 31 focused cases and 682 tests in 132 relevant files pass afterward. Full workspace build and type checks pass. The full run retained 5,784 passes, two stale-metadata failures and eight existing live skips. Regenerating the release inventory and SBOM resolves both failures; all 643 release/distribution tests pass afterward, giving passing observations for all 5,786 executed cases. The release-impact classifier also now recognizes native source/build/transfer changes after eight cases reproduced the missing classification. The final release/distribution rerun passes 651 tests including those eight new cases. The initial full-run failures remain recorded. Darwin arm64 built, standalone, packed and isolated-registry consumer checks pass, as do generated release metadata checks. The transfer candidate's runtime hash is `sha256:ec234ce78155b4818251d632f7df0ab681ef3a244b366139ae2e000ccfc94efe`. Earlier source, resource and platform results retain their original identities. No production installation has changed.

The final target rerun exposed premature SQLite statement collection on the supported Windows Node 22.13.0 runtime. Its installed terminal migration failed after the Node/Hub recovery journey, while Linux and both public quality-event fixtures passed. The [target record](context-quality-platform-qualification.md#current-candidate-requalification) preserves that failure. Four local row adapters now retain statements throughout streaming and release their additional reference on completion or early exit. Forced-GC probes pass on Darwin arm64 and native Windows x64 with Node 22.13.0. The expanded storage, knowledge, migration and common-provider suite passes all 1,017 tests in 183 files. The repaired runtime hash is `sha256:bd35ca367731dd62b4a2602a5681f74e17090493197331fe4b59f06ef241d0ee`; its 8,358,205-byte terminal bundle remains within 8 MiB. The exact rebuilt candidate now passes Linux/Windows installed Node–Hub recovery, all twelve hook integrity checks and both public writer-6 quality fixtures. The original failure remains recorded. Production service PIDs are unchanged. The subsequent [Rosetta checks](context-quality-platform-qualification.md#darwin-x64-execution-under-rosetta) execute all three native copies and pass built CLI, standalone Hub/Node, four SQLite GC probes and 18 native tests under x64 Node 22.13.0. The full packed CLI check times out in the bundled Claude executable. Complete x64 package acceptance, hosted reproducibility and resource, reviewed-quality and operational-cohort gates remain open.

### Preserved implementation baseline

Commit `fc94d015105f8ffc618c04a5f7dab4f04c5f2f69` preserves the 424-path implementation snapshot in [draft PR #108](https://github.com/kimjh96/lervo/pull/108). Its source previously passed 5,599 tests, with eight existing live tests skipped. Fresh worktree quality checks, the built CLI consumer, release manifest and software bill of materials checks pass. These results do not establish resource qualification or release readiness.

The fresh build contains 2,594 runtime files, each byte-identical to the corresponding file in the earlier build. The earlier output directory contains another 17 obsolete JavaScript files. The complete fresh-build hash is `sha256:dba3e9d9b3efd95ef7d4bbf9ac226518ec591da1a66b7da720a2b4e33606b9ca`; the historical directory hash remains `sha256:4a91efb4fb1470ecdfa0102cc70031eedb6de74bc7dd9ad5f72baa21076df889`. Native files and CLI, Hub and Node bundles match exactly. Historical measurements retain their original identities; a new distributed-artifact cohort must bind the actual measured files.

Candidate CI runs `38061548116` and `38061548123` failed before executing jobs because GitHub reported an account payment or spending-limit problem. The release preparation plan proposes `0.22.0` from 27 pending intents but has not been applied. Release completion remains `intent_pending`. No production writer, service, global CLI or repository hook was upgraded.

## Bundled query diagnosis

Four fixed CPU profiles execute the unchanged CLI through its public query command in a disposable repository. The existing deployment tool supplies frozen dependencies; all six runtime/document files match the packed candidate. The fixture has one 32 KiB source, one complete owner rule and an explicitly activated writer 6. Each fresh process starts from the same migrated baseline. Both preparation calls record one event; both artifact-verification calls record preparation and verification. SQLite integrity and exact event counts pass. Artifact verification correctly reports unavailable because this public command has no semantic evaluator.

| Public command                | Elapsed time with profiler | Process CPU | Sampled schema-validator initialization |
| ----------------------------- | -------------------------- | ----------- | --------------------------------------- |
| Preparation, first            | 636.72 ms                  | 823.32 ms   | 410.96 ms                               |
| Artifact verification, first  | 657.62 ms                  | 859.77 ms   | 393.31 ms                               |
| Artifact verification, second | 663.88 ms                  | 873.04 ms   | 409.49 ms                               |
| Preparation, second           | 635.69 ms                  | 821.91 ms   | 393.79 ms                               |

The profiles identify eager compilation of all 209 schema validators as a substantial startup cost. Sampled initialization is an inclusive main-thread observation, not a separately measured CPU total. The public CLI always requests recording; it does not expose the frozen worker's same-writer recording-off control. These whole-process diagnostics include startup, retrieval, rendering and profiler overhead. They cannot replace the existing cold/CPU gates or establish a performance improvement.

An [Ajv standalone-code](https://ajv.js.org/standalone.html) feasibility prototype moves compilation to a temporary build tool while retaining runtime validation. Straight generation produces a minified terminal prototype of 9,653,523 bytes, exceeding the unchanged 8 MiB limit. Shared references and enum loops alone still exceed it. Shared references, an enum-loop threshold of 32 and a required-property-loop threshold of 3 produce a 7,501,825-byte minified prototype. Across 2,573 bounded comparisons against the current validator, including three actual structured results and field mutations, observed validity and error arrays match. This is feasibility evidence, not the full schema contract suite or an accepted production artifact.

No production source or runtime changed during this diagnosis. The subsequent implementation is described below; these historical measurements retain their original bytes and scope.

Owner-local evidence is retained under `/tmp/lervo-bundled-query-6XxX4i/`. The corrected four-process protocol hash is `sha256:e95f427f3005deb16e8579f264af196b1b1eca9993322df4652816c031626353`; `summary.json` has hash `sha256:6ab6c3b28ee47c84739751413fe8482a299c56c5f65c805b18943ef670856d77`. The first offline package installation could not resolve an uncached transitive archive; the frozen deployment path succeeded. A first profile remains rejected because its Python SQLite URI checker could not open the database; the corrected diagnostic uses the runtime's read-only SQLite API. Neither failure was discarded or counted as a passing observation.

## Build-time schema validation

[ADR-0503](../../../decisions/execution/verification/0503-compile-schema-validators-at-build-time.md) moves validator compilation to the schemas build while retaining runtime validation. All 209 schema-name mappings match the previous facade. The first extended differential suite rejected shared references because four fixtures changed `schemaPath` errors. The corrected settings retain inline references, strict/all-errors behavior and the original date-time format; enum and required-property loop thresholds are 3 and 1.

The corrected focused suite passes 387 tests, including existing schema fixtures, exact-error differential comparisons, artifact drift and release inventory tests. A clean temporary copy typechecks before generation, builds and executes with string-based code generation disabled, and reproduces both generated files exactly. Generated validators occupy 6,072,182 bytes; the minified terminal bundle occupies 8,356,983 bytes against the unchanged 8,388,608-byte limit. Its remaining 31,625-byte margin is small and remains checked on every build.

The full workspace build and code-quality checks pass. Release metadata initially failed because the outer bundle could no longer identify embedded runtime helpers. The generated manifest now carries their observed package coordinates into the release snapshot and SBOM, preserving the exact dependency check. Full regression passes 5,761 tests in 1,101 files, with eight existing live tests skipped. A subsequent staging-ownership correction passes the 387 focused tests and quality checks; its generated validator hash remains `sha256:2c8318091093a2b4425884569a4b68732ad864a5033acda7145289a06d8c8c08`. An exclusive fixed stage prevents simultaneous generators from deleting each other's temporary files.

Built CLI, Hub and Node consumers, standalone Hub/Node archives and the packed CLI consumer pass on Darwin arm64. Node 22.13.0 also passes public validation with string-based code generation disabled and the installed CLI smoke. Release inventory, SBOM and local unsigned-statement checks pass. These fixture journeys do not establish actual provider or Discord acceptance. No production service, CLI or hook has been upgraded.

The earlier schema-compilation candidate passed [Linux and Windows requalification](context-quality-platform-qualification.md#current-candidate-requalification), including native Windows Node 22.13.0. Fresh installed Node/Hub pairs synchronize matching events, restart without duplicates and recover from a Hub outage. All twelve installed hook execution, tamper and restoration checks pass. Exact new archives and seven CLI files are verified; production WSL service PIDs and executable/configuration hashes remain unchanged. Darwin x64 and hosted reproducibility remain open.

### Paired startup diagnosis

A finite eight-process comparison restores the same migrated writer-6 fixture for both old and new deployed CLI bytes. Each arm executes preparation twice and artifact verification twice in a fixed interleaved order, with CPU profiling enabled. All eight observations preserve the passage, complete rule, expected unavailable semantic verification, exact event counts and SQLite integrity. No sample is retried or removed.

| Arm                   | Mean elapsed time | Mean process CPU | Elapsed range    |
| --------------------- | ----------------- | ---------------- | ---------------- |
| Previous bundled CLI  | 651.73 ms         | 837.70 ms        | 649.33–654.49 ms |
| Build-time validators | 385.96 ms         | 344.92 ms        | 291.73–647.02 ms |

Observed mean elapsed time falls 40.8% and process CPU falls 58.8%. The first candidate preparation takes 647.02 ms and remains included. Four observations per arm with uncontrolled operating-system caches support a startup diagnosis, not statistical acceptance or the separate recording-resource gates. Both arms always record, and whole-process timing includes startup, retrieval, rendering and profiler overhead.

The owner-local evidence directory is `/var/folders/0q/n1zzqlr11v78pn8x5yvs8nl80000gn/T/lervo-schema-startup-vojm7v98`. Its protocol, result and summary hashes are respectively `sha256:b79495e6a2c463a74465363e0be48079bdc0442b09c281998987744dde7814ce`, `sha256:c30c24abf39cae3edb281e455f24066a55110f3fe2b56354df6326b316af80a2` and `sha256:0b669059214e4c612b8e99900c17cb38f137d35ca721429a109017f67f1a8464`. It retains exactly eight profiles, bounded raw logs, the deployed candidate and the registered protocol/results until review. Prior profiles and frozen benchmark artifacts remain unchanged.

## Current recording cost

The [current recording diagnosis](context-quality-native-sync-implementation.md#current-recording-diagnosis) retains 88 additional source workers after build-time validator compilation. Every worker passes fixture semantics, source checks, event counts and integrity. Removing a duplicate observation snapshot gives no consistent gain. Rechecking next-turn initial-borrow grouping yields a small concurrent CPU decrease with increased latency, so it also remains unselected. Product runtime and installed artifact bytes stay unchanged.

These finite diagnostics do not qualify the distributed recording gates. Both cold latency groups and all eight CPU groups remain open. Further performance work needs a new measured cause; the consolidated source, retention and privacy review is now complete for the PR diff. Hosted release verification, reviewed real-task cases and production acceptance remain required.

## Source and real-task evidence

| Record                                                                   | Evidence boundary                                                                  |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| [Source verification](context-quality-source-verification.md)            | Shared preparation, observations, event readers and inactive-writer qualification. |
| [Initial evaluation](context-quality-priority4-evaluation.md)            | Case coverage and active-recording resource failures.                              |
| [Provenance recovery](context-quality-provenance-recovery.md)            | Historical request and corpus bindings.                                            |
| [Conversation recovery](context-quality-conversation-source-recovery.md) | Retained inputs and private review preparation; no new reviewed families.          |

## Recording performance evidence

| Record                                                                 | Measured responsibility                              |
| ---------------------------------------------------------------------- | ---------------------------------------------------- |
| [Storage reuse](context-quality-recording-repair.md)                   | Storage connections and event integrity.             |
| [Commit grouping](context-quality-commit-repair.md)                    | Bounded transactions.                                |
| [Small reads](context-quality-small-read-repair.md)                    | Fresh metadata I/O.                                  |
| [Manifest decoding](context-quality-manifest-parse-repair.md)          | Exact-content parsing reuse.                         |
| [Preparation batching](context-quality-preparing-batch-repair.md)      | Recording admission.                                 |
| [Event validation](context-quality-event-validation-repair.md)         | Envelope checks.                                     |
| [Write sharing](context-quality-cas-sharing-repair.md)                 | Unfinished content-addressed writes.                 |
| [Read overlap](context-quality-read-overlap-repair.md)                 | Observation and recording lifetime.                  |
| [Path expansion](context-quality-path-expansion-repair.md)             | Repeated project path calculations.                  |
| [Writer admission](context-quality-writer-admission-repair.md)         | Fresh storage-pool admission.                        |
| [Native follow-up](context-quality-native-sync-followup.md)            | Durable synchronization diagnosis.                   |
| [Native implementation](context-quality-native-sync-implementation.md) | Source integration and later diagnostic comparisons. |

## Distribution evidence

| Record                                                                   | Consumer boundary                                         |
| ------------------------------------------------------------------------ | --------------------------------------------------------- |
| [Standalone runtimes](context-quality-native-standalone-distribution.md) | Hub and Node archives.                                    |
| [CLI distribution](context-quality-native-cli-distribution.md)           | npm package and native artifact transfer.                 |
| [Terminal installation](context-quality-native-terminal-installation.md) | Durable native asset installation and recovery.           |
| [Target qualification](context-quality-platform-qualification.md)        | Linux and Windows isolated consumers and installed hooks. |

## Retention and organization

The collection has 20 retained stage records and this current overview. Update this overview and the existing responsibility-specific records for further work instead of adding a document for each run or revision. Git preserves their edit history. The repository's unchanged limit of 32 direct documents applies to this directory; exceeding it requires a semantic reorganization or consolidation review.

After organization, the parent directory has 14 direct documents and this directory has 21. Knowledge lint is valid with 131 warnings, including existing missing links outside this collection and stale lifecycle records. The knowledge migration plan is ready with 1,749 operations and no blockers; it was not applied. The moved documents differ only in link destinations, all their local links resolve, and all 61 existing evidence and protocol JSON files remain byte-identical. Documentation lifecycle and repository quality checks pass.

Existing frozen JSON results remain at their original paths in the parent directory, and registered protocols remain under `benchmarks/context-quality/`. Their bytes, failed observations, build bindings and acceptance thresholds are unchanged by this organization. Do not add a sequence of per-run canonical files to extend this historical collection. Any new measurement design must define a finite result set and retention contract before execution. Private conversation review material stays outside the repository under its original expiry obligation.
