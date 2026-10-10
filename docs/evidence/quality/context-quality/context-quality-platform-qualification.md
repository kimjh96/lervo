# Context quality target-platform qualification

Status: `partial`
As of: 2026-10-11

This record advances [ADR-0502](../../../decisions/distribution/0502-bind-native-sync-assets-to-standalone-runtime-distributions.md) and the [remaining delivery scope](../../../roadmap/natural-language-grounding-quality/context-quality-parity.md). The owner authorized continued implementation, verification and fleet deployment. Isolated installation evidence does not establish production activation or context-quality acceptance.

## Current candidate requalification

Candidate `c81e47a8ef28fc48b9e799f30365f956a2525595` now passes rebuilt isolated CLI, Hub, Node, terminal-hook and quality-event checks on WSL Linux x64 with Node 26.5.1 and native Windows x64 with Node 22.13.0. The original Windows failure and its correction remain explicit below.

Requalification of reviewed source `6fd60b5fd51d5270b4dca85508504f5db5f57d2f` found a supported-runtime defect. Linux x64 with Node 26.5.1 passed isolated CLI, Hub, Node, installed-hook and quality-event checks. Native Windows x64 with Node 22.13.0 passed installation, Node/Hub synchronization and restart recovery, plus public writer-6 quality recording. Its subsequent terminal migration failed with `knowledge_evidence_source_invalid`; it is not a complete Windows pass.

An instrumented copy traced the failure to `ERR_INVALID_STATE: statement has been finalized` during outbox integrity iteration. Three independent probes reproduced premature statement collection on Node 22.13.0 arm64. The [upstream Node correction](https://github.com/nodejs/node/pull/57569) also identifies missing statement retention in its original iterator. Earlier successful fixtures did not rule out garbage-collection timing failures.

The local row adapters now receive and retain each prepared statement for the cursor lifetime. A private symbol avoids collision with the old native iterator's read-only `statement` property. Normal exhaustion, validation failure and early return preserve iterator cleanup and clear the additional reference. Event/outbox inspection, interaction scans, deliberation queues and Hub graph rebuilding use these adapter boundaries. Rows remain streamed, and existing validation and failure meanings remain intact. No package export, statement cache, persistent collection or schema changes.

Four subprocess regressions force garbage collection before the first row and between rows, verify bound parameters and exact remaining rows, then interrupt another cursor and drop its table to check release. All 19 row-adapter tests pass on Node 22.13.0 arm64. The first repair attempted a property name already reserved by the native iterator; its seven failed assertions remain recorded. A later type check rejected an overloaded parameter tuple; the boundary now accepts the anonymous SQLite values used by its callers. The expanded suite passes all 1,017 tests in 183 files across storage adapters, knowledge migration and both provider adapters. The rebuilt installed-target checks described below also pass.

The repaired build has runtime identity `sha256:bd35ca367731dd62b4a2602a5681f74e17090493197331fe4b59f06ef241d0ee`. Its terminal bundle is 8,358,205 bytes, leaving 30,403 bytes below the unchanged 8 MiB limit. Full workspace build, type checking and architecture checks pass. The release manifest and software bill of materials were regenerated through their owners and both checks pass. Darwin arm64 built CLI/Hub/Node, packed CLI and standalone Hub/Node consumer checks pass, as does the unsigned three-subject statement check. These controlled fixtures do not establish real provider or Discord acceptance. These are new artifacts; prior resource and installed results retain their original identities.

The initial target evidence remains in `/var/folders/0q/n1zzqlr11v78pn8x5yvs8nl80000gn/T/lervo-final-target-gfmr4lb8`. It binds unchanged runtime `sha256:ec234ce78155b4818251d632f7df0ab681ef3a244b366139ae2e000ccfc94efe`, source transport, package bytes, target artifacts, passing checks and the Windows failure. Linux artifacts were copied back and rehashed. The previous candidate `198f0973` and its successful results remain in the earlier owner-local evidence set `/var/folders/0q/n1zzqlr11v78pn8x5yvs8nl80000gn/T/lervo-schema-target-nk81ow8n`; they cannot qualify the repaired bytes.

Both rebuilt targets install CLI archive SHA-256 `064b61ceb9077536694ca44e06ec28202b7fcf9ed2d80ce8c65434fe90747fae` with scripts disabled. All seven installed files match the archive, and all transitive dependency-lock entries remain unchanged. Target-side Node assembly uses pnpm 11.18.0, the frozen repository lockfile and isolated user state. The distribution owners build and verify these manifest-schema-2 archives:

| Target      | Artifact | Archive bytes | Archive SHA-256                                                    |
| ----------- | -------- | ------------: | ------------------------------------------------------------------ |
| Linux x64   | Node     |    99,627,617 | `d87d5d412e89e5e2764e94e48f54ab792417c54ef825b700c88cac5c5e4469c3` |
| Linux x64   | Hub      |       768,410 | `bf24abebb9b7e4b3759299d76787da7d480bd3dee9d0ab3d9b85f75059fde65d` |
| Windows x64 | Node     |    98,217,451 | `7ea85754f453d847d4748cfac774b969067b9ae5c27a294966c1bbf26bc2e59c` |
| Windows x64 | Hub      |       766,305 | `3918c6e16950d4110d9fb5b537378272e86c128405eb5ade038d1565acc0b235` |

The Node bundle hash is `sha256:9b96c38d759e95fe20c720dcae486e0f6815fe62034cbb350cf2f2888cf33794` and the Hub bundle hash is `sha256:29b4dc1bbe5398825a5c6c633e4f4468623c858bcf8e9e9ac67c6eb86df9caed`. All four archives were copied back to the Mac and independently rehashed. Both manifests and software bills of materials match their installed inventories.

Each installed Node synchronizes an initial workstream event over loopback TLS, restarts without duplicating it, synchronizes a second event and recovers from a Hub outage. Complete ordered event sequences and hashes agree, and both SQLite databases pass integrity checks. Duplicate installations and wrong expected digests are rejected. Linux shutdown is graceful; Windows exercises forced native termination and subsequent recovery.

Both installed CLIs now complete structural, bridge and terminal migration. Twelve hook checks cover Codex and Claude entries, nested working directories, native-byte tampering and exact restoration. The Stop recursion guard keeps these checks separate from real provider sessions or model use. Separate public writer-6 fixtures retain one exact passage and a complete synthetic rule, record the expected three quality events and pass SQLite integrity. Artifact verification correctly reports unavailable with exit 2 because the public query has no semantic evaluator.

Corrected raw results, runners and artifacts are retained under `/var/folders/0q/n1zzqlr11v78pn8x5yvs8nl80000gn/T/lervo-final-target-gfmr4lb8/repaired`. The summary hash is `sha256:0edc9b31b3191f67abb6f81276190a3b149af742910d1f0972afce0959525650`. The finite parent set retains the original failed candidate and one repaired candidate; no production credentials or private review packet were copied. The Mac isolated-registry preflight also passes at 0.21.0. Final observation confirms unchanged production Hub, six Node and forwarding-service PIDs with zero automatic restarts. No production service, global CLI, repository hook or writer changed. Darwin x64, hosted reproducibility, recording-resource gates, reviewed real-task quality, actual provider/Discord journeys and the operational cohort remain open.

## Preserved state and live inventory

All 411 paths in the preceding source backup were present and byte-identical before this slice. The complete runtime remains `sha256:4a91efb4fb1470ecdfa0102cc70031eedb6de74bc7dd9ad5f72baa21076df889`; no application bundle changed in this platform-verifier repair. Existing benchmark cohorts and backups remain unchanged.

Fresh registered-target observations resolve the Windows host online. Its WSL Ubuntu Hub and six Node user services are active with zero automatic restarts. Exact interpreter, executable and configuration digests were recorded privately for later guarded transitions. Mac CLI, knowledge host, Node and replica definitions were inventoried without disclosing credentials. No production service, CLI pointer, repository hook or writer selection changed.

## Observed defects and repair

The first Windows attempt rejected a valid archive as `hub_distribution_archive_invalid`: native tar emitted CRLF, while the parser treated the trailing carriage return as part of every path. A shared line decoder now handles Windows CRLF and LF. POSIX trailing carriage returns, embedded control characters, traversal and duplicate entries remain available to the existing rejection checks.

The corrected parser exposed `hub_distribution_content_mismatch`: Windows reports writable ordinary files differently from POSIX `0644` and `0755`. The shared pure inventory comparison retains exact POSIX modes and compares the observable read-only attribute on Windows. This follows the [Node filesystem mode contract](https://nodejs.org/download/release/v26.5.1/docs/api/fs.html#file-modes). Full original modes remain bound by the independently checked archive digest and manifest. Names, types, sizes, content hashes, link targets and membership still match exactly; no Windows ACL assurance is claimed.

The shared tar adapter owns command-output decoding. The pure inventory comparator owns platform observation semantics. Hub and Node orchestration reuse both without changing their manifest schemas, failure codes or service authority. Each touched production module remains cohesive and below 400 lines; no structural exception was added.

## Actual Hub executions

| Target               | Runtime      | Exact archive SHA-256                                              | Result                                                                        |
| -------------------- | ------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| WSL Linux x64, glibc | Node 26.5.1  | `d60af2aa155872498503e739cc73f930fe39479f25949004091556a767f904de` | Installed into a new isolated directory; configured startup and shutdown pass |
| Native Windows x64   | Node 22.13.0 | `0f161360fbe0c259a6b39ab71b8f2a0b682121f49ecdb03a12c74cd477d7031e` | Installed into a new isolated directory; configured startup and shutdown pass |

Both archives use manifest schema 2 and execute Hub bundle SHA-256 `4e2f16d6bc4e41acd62a83ed8a5d939625fe33ba64c30849712eb16954b04f2e`. They omit Darwin native assets as required. The target-side verifier checks OS, architecture, libc, exact archive digest, inventory and SBOM before its configured smoke. Both targets independently reject a corrupted archive and changed read-only state. Synthetic smoke credentials and loopback listeners are isolated from production configuration.

The Windows Node archive was obtained from the official versioned distribution and checked against its published SHA-256 list: `node-v22.13.0-win-x64.zip`, 34,866,524 bytes, SHA-256 `b0feb09ebf41328628e7383f7a092fb7342ce1e05c867a90cf8f1379205a8429`. This executes Windows Node directly; WSL only transports inputs and starts the process. Neither a Windows-host label nor Linux execution is used as Windows evidence.

## Isolated CLI and Node consumers

Both targets install the same CLI archive, SHA-256 `b9e3a9ba682bedbed9470dcf93f7ff1eb6ea8a9d87ba622e240caf68eec78c74`, with install scripts disabled. All seven installed package files match the original archive bytes. Version, project initialization, knowledge query, Node argument handling and Node configuration preflight pass. The target-specific SDK dependencies are installed, but no provider task or SDK conversation is started.

Both queries prepare the same complete synthetic owner-rule bytes, report one prepared clause with no omissions and `delivery=unobserved`, and retain `recording=writer_not_active`. The overall quality plan remains `incomplete` because this small fixture does not supply full corpus/token coverage. This is narrower than a successful quality plan or provider delivery.

The first diagnostic incorrectly assumed identical writer state after ordinary initialization. Linux onboarding observes its existing host continuity policy and selects writer 4, with a local reader advertising versions 1–6. Windows has no such policy and retains implicit writer 1. The Linux initialization also registered the disposable fixture in the host registry. Cleanup removed only that exact fixture registration under the registry lock with before/after verification and a private backup; all three pre-existing entries remained unchanged. Subsequent isolated initialization must use `--minimal` and an isolated user-state directory. No production writer or service changed, and no writer 6 was activated. These environmental differences are retained rather than presented as onboarding parity.

## Standalone Node and installed hook journeys

The [target-consumer record](../context-quality-target-consumers-v1.json) now binds complete installed Node and hook checks on both targets. Each Node archive is assembled by the unchanged distribution owner on its target OS, using pnpm 11.18.0 and the exact frozen dependency lockfile. Dependency installation disables scripts and uses isolated user state; the Linux archive assembly uses the warmed offline store. The Windows builder retains its existing prefer-offline policy. Neither archive is a public release.

| Target           | Node version | Archive SHA-256                                                    | Archive bytes | Manifest entries |
| ---------------- | ------------ | ------------------------------------------------------------------ | ------------: | ---------------: |
| Linux x64, glibc | 26.5.1       | `47723c32dc378ba0108eb78cd1be36526ca383a60db1b1cfa4413019d1fcda10` |    99,105,379 |            5,826 |
| Windows x64      | 22.13.0      | `94c1ee292ae9797cf568633c514b951ed5914963ddd81a6e502d50e691c2ba88` |    97,697,918 |            5,834 |

Both archives install outside a checkout with manifest schema 2, exact target dependency closure, matching bundle bytes and configuration preflight. Duplicate installation and an incorrect expected digest are rejected. Before subsequent execution, every installed manifest entry is compared again with the archive-bound inventory. All seven CLI files are checked against the original npm archive, including its packed package metadata.

Each installed Node connects to an installed Hub over loopback HTTPS with an isolated trusted test certificate and synthetic credentials. A new fixture uses `init --minimal` and isolated HOME/config/data/cache paths. The Node reaches `ready`, advertises readers 1–6 and synchronizes a real workstream event. After Node restart, readiness returns without a duplicate event. A CLI workstream update produces a second synchronized event. Stopping the Hub makes Node health `degraded`; restarting the same Hub restores `ready`. After shutdown, both SQLite integrity checks pass and the complete ordered local/Hub event sequences and hashes match exactly. Linux processes exit gracefully with code 0. Windows processes undergo forced native termination and recover on restart; this does not establish graceful Windows service shutdown.

The actual installed CLI then applies structural migration, the exact new Claude bridge and the exact terminal-integration plan inside each owned fixture. Installed hook JavaScript and both native files match their original archive hashes. Both provider entries run from a nested working directory, reject a modified native binary before processing input with exit 2, and succeed again after exact-byte restoration: six checks per target. These are direct installed hook process calls with a Stop recursion guard. They do not establish actual Codex trust, provider injection/use, a model outcome or Darwin native execution.

Three diagnostic setup failures remain recorded: a Windows scratch-runner placeholder collision, an initial comparison against source rather than packed package metadata, and a Linux TLS certificate with permissions broader than 0600. The corrected harness retains archive identity and secure-file checks. No product source change was needed. The final check finds all seven production WSL services active with unchanged PIDs, executable/configuration hashes and zero automatic restarts. Both new archives were copied back and independently rehashed; the application runtime remains unchanged.

## Verification and remaining scope

The focused platform/archive suite passes 25 tests in five files. It covers Windows and POSIX line handling, read-only drift, content/type/path/link/membership mismatches, native assets, legacy readers and both distribution contracts. Native Darwin Hub and Node standalone smokes also pass after the verifier repair.

The initial full workspace run retained 5,581 passing tests, four failed assertions and one failed suite load. Five focused regression files pass 24 tests after corrections: full terminal rule bytes replace a retired title-only expectation; the CI test requires the native producer before the shared build; sync tests accept reader schema 6 and reject 7; the convergence command uses a partial storage mock; and the historical v18 test separates immutable contract contents from present-day execution eligibility. V18's reviewed source digests and loader stay unchanged, and an explicit changed-source fixture must fail before execution.

The final full suite passes 5,599 tests in 1,098 files, with eight tests in seven files skipped by their existing live-test conditions. It completes in 549.37 seconds with no failures. Type checking, quality (59 long modules and 748 script modules), architecture (103 packages), documentation lifecycle (539 registered documents), natural-language evaluation and brand checks pass. Generated release manifest and SBOM checks pass with seven files, 100 portable dependencies, 226 components and 111 dependency nodes. The unsigned three-subject attestation check passes; this is not hosted provenance. The built application runtime hash remains unchanged after these checks.

Reviewed patch intent `relint_7104eda6178524ddb11a7d43` covers the compatible archive-verifier correction. The base-bound completion check against `53eec5565af89eae2a18acd2d39cd99d78358a61` reports `intent_pending` across 422 changed paths. This records pending release work, not release readiness. All previous 411 source paths and historical benchmark/evidence JSON remain preserved; five previously dirty files changed in this slice and eleven more paths became dirty.

The latest hosted [Code quality run](https://github.com/kimjh96/lervo/actions/runs/38045513936) failed before running steps. Its check annotation reports failed account payments or a spending limit. Local and target-side observations cannot substitute for the required exact successful hosted release run.

The isolated Linux and Windows Node/Hub lifecycle and installed hook checks above now pass. Actual provider sessions, production Discord journeys, Darwin x64 native execution, same-workflow transfer and fresh-workflow reproducibility remain unqualified. Both cold latency and all eight CPU gates remain open, as do 100 reviewed real-task families, 30% unseen family holdout, repeated provider results, production recovery journeys and the seven-day-plus-task-count observation. Writer defaults remain unchanged. No performance, full fleet rollout or goal-completion claim follows from these checks.
