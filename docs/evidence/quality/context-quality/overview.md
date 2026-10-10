# Context-quality evidence

Status: `partial`
As of: 2026-10-11

This collection records implementation and evaluation of [ADR-0501](../../../decisions/execution/grounding/0501-share-context-quality-contracts-across-product-surfaces.md) and [ADR-0502](../../../decisions/distribution/0502-bind-native-sync-assets-to-standalone-runtime-distributions.md). The [delivery roadmap](../../../roadmap/natural-language-grounding-quality/context-quality-parity.md) defines the remaining acceptance requirements. Historical documents describe their measured source revision and stage; their status lines do not describe the current release.

## Current candidate

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

Next implement a generated-validator owner with exact schema/options binding, preserved date-time semantics, clean-build and source-test support, deterministic output, full schema/adverse differential coverage and runtime artifact identity. Verify terminal size, minimum-runtime consumers and both core and installed performance before adoption. No production source or runtime changed during this diagnosis.

Owner-local evidence is retained under `/tmp/lervo-bundled-query-6XxX4i/`. The corrected four-process protocol hash is `sha256:e95f427f3005deb16e8579f264af196b1b1eca9993322df4652816c031626353`; `summary.json` has hash `sha256:6ab6c3b28ee47c84739751413fe8482a299c56c5f65c805b18943ef670856d77`. The first offline package installation could not resolve an uncached transitive archive; the frozen deployment path succeeded. A first profile remains rejected because its Python SQLite URI checker could not open the database; the corrected diagnostic uses the runtime's read-only SQLite API. Neither failure was discarded or counted as a passing observation.

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
