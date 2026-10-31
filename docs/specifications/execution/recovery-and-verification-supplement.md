# Recovery and verification supplement

This supplement records contracts from the eight linked ADRs against the supplied execution baseline. Test and operational observations below are reported by those sources; this assessment performed no runtime tests, benchmark, deployment, packed smoke or publication.

## Assignment amendments and retained checkout proofs

[ADR-0513](../../decisions/execution/orchestration/governed-work/owner-recovery/0513-supersede-unwritten-assignment-amendments.md) extends never-bound claim recovery to never-written assignment amendments.

`allUnstartedSupervisionWorkspaces` proves all retained checkouts using one shared evidence read and at most four concurrent Git inspections. Assignment amendment and responsibility revision admission use this observer. Each proof retains its own five-second freshness bound; one unproven checkout rejects the set.

An uncertain amendment retries only before the earlier of its plan deadline and responsibility start deadline. A refused retry returns the receipt state instead of failing the inspection cycle. When the source changes or the start deadline passes, supersession requires the owner fence, absence of the deterministic `assignment.amended` event and an unchanged assignment record. Version-7 `work.effect_absence` covers both `work.assignment_amendment.v1` and `work.responsibility_claim.v1`. The journal validates the amendment start deadline, which `readEffectStartDeadline` exposes.

The source reports regression coverage for one retry within the start window, one supersession after it, no assignment mutation, and 21 checkout candidates inspected with concurrency four and one shared evidence read. These are source-reported results, not new installed acceptance.

## Repository-head transition fences

[ADR-0514](../../decisions/execution/orchestration/governed-work/owner-recovery/0514-fence-supervision-transitions-on-the-repository-head.md) distinguishes the repository event head from the last event in workstream-scoped history.

`SupervisionTaskSource.read()` returns `headEventHash`, observed before reading scoped history. Transition fences compare the current repository head with this coordinate for workspace preparation and recovery; owner attention, artifact review and goal completion; assignment completion, cancellation and handoff; request binding, result delivery and owner reasoning admission.

An unrelated event already present before the source read does not invalidate the transition. Any event appended afterward, inside or outside the workstream, fails the fence and requires a fresh read and retry. Scoped history does not weaken repository-wide append detection.

`currentSupervisionWorkspaces` shares one evidence read for proofs over one store. Inspections remain in batches of four and stop at the first unproven batch. This shortens fence windows without removing checks. The source reports two workspace scenarios with another run's completion at the repository head, including lost-receipt recovery, and eight unchanged passing scenarios.

## Withdrawal of never-ready workspace preparations

[ADR-0515](../../decisions/execution/orchestration/governed-work/owner-recovery/0515-supersede-preparations-that-stopped-before-their-host-effect.md) adds recovery for preparation records created before their host effect completed.

`observeUnhostedWorkspace` requires all of the following: a `provisioning` record at revision 1, a `recovery_required` record at revision 2 with `host_effect_uncertain`, or a revision-3 `removed` record withdrawn by this plan; coordination history containing only provision, recovery and withdrawal events; no native instance digest or writer; an absent checkout path; and Git confirmation that the workspace is absent. Recovery reports this preparation as `not_started`.

Under the existing source-change or deadline conditions, supersession withdraws the record to `removed` with `hostAbsent` and `gitMetadataAbsent` evidence. It records version-9 `work.effect_absence`, replacing version 3's `workspaceRecordAbsent` and `coordinationEventsAbsent` fields with `workspaceRecordWithdrawn` and `readyEventAbsent`. The journal accepts both versions. Deterministic withdrawal events allow an interrupted withdrawal to resume.

The untouched-checkout amendment also permits withdrawal when provisioning has ended at `recovery_required` revision 2 and Git proves that the present checkout has the matching marker, is clean, remains at the base commit and has no Git operation running. The record must never have had a writer or native instance digest. Withdrawal first uses Git's non-force removal, then withdraws the record. Dirty, changed or potentially active host work remains protected; forced removal is never used.

The source reports `expired_unhosted` and `expired_unready_checkout` regressions that previously remained uncertain and now remove the eligible record or checkout and supersede preparation. These narrow recovery cases do not grant general cleanup authority.

## Worker-readiness holds before owner planning

[ADR-0516](../../decisions/execution/orchestration/governed-work/owner-recovery/0516-hold-owner-planning-while-worker-readiness-is-blocked.md) adds a process-local hold for readiness failures occurring before the effect-time preflight barrier.

A final readiness refusal or an incomplete readiness probe holds owner planning for that supervision. The hold retains the exact plan, `readiness_*` reasons, blocked-cycle cause and a digest of Node readiness inputs. A probe failure still fails its cycle; `supervision_readiness_stale`, for example, is recorded as `readiness_unobservable`.

The optional `readReadinessInputs(plan)` port hashes runtime readiness configuration, the knowledge snapshot for the plan's paths and knowledge readiness. These inputs exclude the plan lease. Before requesting another owner plan, the runtime rereads them. Unchanged inputs and cause produce `worker_readiness_unavailable` with the retained reasons, without owner reasoning, a claim or workspace preparation.

Changed or unreadable inputs, a new cause such as a workstream snapshot, or a dispatch reaching its effect releases the hold. Restart clears this in-memory state and permits another planning attempt. None of these process-local release conditions proves repair of a separate durable preflight barrier. The hold creates no canonical event and grants no authority.

The source retains the initial deployment failure: holding only gate refusals missed thrown probes and allowed two further planning rounds consuming 191,371 tokens. Reported tests cover post-supersession suppression, input changes, new causes, thrown probes and readiness-digest stability.

## Observation-only supervised responsibilities

[ADR-0517](../../decisions/execution/orchestration/governed-work/owner-recovery/0517-run-read-only-supervised-responsibilities-observation-only.md) classifies supervised execution from required capabilities. A responsibility without `filesystem.write` runs with `executionMode: "read_only"` and no write targets. Expected paths continue to scope context selection and knowledge readiness.

A responsibility requiring `filesystem.write` retains its write targets and the role's approval rules, including `require_approval`. Read-only classification avoids an irrelevant write-approval preflight while still producing a result artifact; it does not grant write permission. The source reports classification tests and existing orchestrator approval coverage for an observation-only run.

## Host-local terminal runtime reconciliation

[ADR-0539](../../decisions/execution/providers/hooks/0539-keep-the-terminal-hook-runtime-host-local-behind-a-tracked-launcher.md) keeps a dependency-free launcher at `.lervo/generated/terminal-hooks/runtime-v2.mjs`. Its schema-4 `runtime-v2.json` has kind `lervo_terminal_hook_launcher` and binds its byte count and SHA-256. The launcher is at most 16 KiB and contains no CLI release or build identity. Contract-2 handlers, Windows PowerShell commands and Codex trust paths stay at the same repository entry point. Node 22.13 and Git remain prerequisites. Hooks work from repository subdirectories without a global `lervo` on `PATH`.

The full runtime and native assets live in `~/.lervo/terminal-hooks/` on macOS and Linux, or `%LOCALAPPDATA%\Lervo\terminal-hooks\` on Windows. Each directory is named by the first 16 hexadecimal characters of the runtime hash; repairs may append `-repair-` and 16 random hexadecimal characters. Its schema-3 integrity manifest retains the runtime path coordinate, contract, byte count, content hash and asset bindings. This coordinate identifies the artifact contract, not its host filesystem location. Native asset identity is bound into the bundle at build time. A native-only update therefore receives a distinct store directory.

The private pointer `current.json` has schema version 1, `directory`, `contentHash`, the publishing CLI entry's real path `publisher`, and a nullable `predecessor` with the previous directory and full hash. One SQLite writer lock in `.materialize-lock.sqlite` guards temporary-directory publication, pointer replacement and retention. The kernel releases this lock when a holder exits or crashes; no PID expiry can admit two writers. The pointer changes last. Keep the current directory and its predecessor. A replace-in-place `.pending.json` record holds schema version 1 and the desired `contentHash` until retention completes. Startup retries this interrupted work even when the pointer already names that hash. Directories use `0700`; files use `0600`. No repository paths, input, credentials or provider output enter these files.

The launcher verifies runtime and declared asset lengths and SHA-256 before starting the runtime or reading provider input. It imports the runtime in the same Node process, preserving arguments, streaming stdin, cwd and exit status. A one-use process-local verification receipt avoids redundant runtime verification after launch; direct runtime invocations still verify themselves. `LERVO_TERMINAL_HOOK_RUNTIME` names the host runtime, including for detached prefetch and knowledge work. Missing stores, pointers, manifests, runtimes, declared assets, or target directories return empty success as `unmanaged`. Missing files after pointer read, including import, reread the pointer once before returning unavailable. The launcher replaces one private `unavailable.json` marker with `{ "schemaVersion": 1, "code": "hook_runtime_unavailable" }`. An unwritable marker never blocks an unmanaged turn. Malformed, linked, changed or oversized artifacts fail closed with exit 2 and the fixed integrity message. POSIX store and runtime directories and the pointer require the current uid and no group or other writes; parent symlinks must remain within the user's real home. Windows ACL validation remains deferred. Integrity failures also write a best-effort private `repair.json` marker with schema 1 and code `hook_runtime_repair`, containing no paths or input. Same-user verification-to-import TOCTOU is outside this contract. Both providers interpret exit 2 as blocking UserPromptSubmit and forcing Stop continuation.

Interactive installed startup compares the pointer with the installed bundle's embedded hash and publishes when it differs. An adjacent `../src/bin.ts` identifies a source checkout, whose startup never publishes. `lervo migrate knowledge` also has publication authority. The pointer records the publishing CLI entry's real path as `publisher`. Host residents are repair-only: they publish for missing or invalid state, unavailable or repair markers, interrupted publication, or a removed publisher entry. They recheck authority under the host lock and preserve valid runtimes from other publishers. Both default startup and resident paths verify marked artifacts before repair. Same-hash repair stages a fresh directory and switches the pointer without deleting the current directory. Successful repair clears the markers. Failed repairs retry on the next scan. `hook_runtime_unavailable` belongs to the host resident and requires no owner action unless a consequential repair failure persists. ADR-0470 local-reader preflight checks the verified currently published host runtime for schema-4 launchers, without requiring the resident's own hash while another publisher remains installed. Legacy repository bundles still require launcher reconciliation before reader activation.

Migration reads integrity schemas 1–3. Generated-only reconciliation replaces the old repository bundle and manifest and removes its generated native assets under exact current hashes and the existing rollback journal. Provider configuration retains its exact approval boundary. Each plan binds the latest `terminal.integration.applied` event or null. The event's `runtimeAfterHash` becomes the launcher hash; no new event is added. Rollback restores removed binary assets and emits no success event. Events exclude paths, bodies, commands, runtime bytes and output.

Readiness requires `lervo_terminal_hooks_v2`; in-flight contract-1 calls and v1 receipts do not prove it. ADR-0327 keeps unmatched and re-entrant Stop as empty success without evidence. Installed acceptance remains separate: on Mac and WSL, upgrade Lervo without changing tracked bytes in `lervo`, `flemo` or `axli`, then verify `UserPromptSubmit` from a repository subdirectory.

## Build-time schema validation

[ADR-0503](../../decisions/execution/verification/0503-compile-schema-validators-at-build-time.md) assigns a build-only compiler and declarative catalog to the schemas package. `validateSchema` executes generated validators without constructing Ajv or evaluating generated strings at runtime. Schema names, definitions, date-time behavior, verdicts and error arrays remain contractual. Authored types resolve before build and generated JavaScript at execution.

Generation preserves strict mode, all errors and inline references, with required-property loop threshold 1, enum-loop threshold 3 and optimization level 2. Disabling inline references was rejected because it changed `schemaPath` errors. Original compiler settings remain the differential oracle.

Generator version 4 retains static primitive enum indexing. One lazily created membership set belongs to each referenced compiled schema array through a private weak map. Only finite catalog constants are retained. Short lists, structured values and request-defined `$data` enums use the original compiler path. Public failures deep-copy error arrays and nested parameters, preventing caller mutation of shared definitions; private validators and enum arrays are not exports.

The generator owns exactly four replaceable files under `dist/generated`: `validators.js`, `selected-validators.js`, `coordinate-data-validators.js` and `manifest.json`. The manifest binds schema/generator versions, sorted repository-relative source paths and hashes, aggregate source identity, schema count, Ajv/esbuild versions, options, output digest and length. Its `selected` descriptor binds exactly twelve sorted schema names and selected output bytes. Full and selected functions come from one canonical catalog compilation and have identical corresponding bodies. Source identity includes schema TypeScript, lockfile, package configuration, selection and coordinate contracts, and generation/verification owners. It detects drift, not independently authenticated provenance.

A bounded, sorted `runtimeDependencies` inventory comes from actual generated bundle inputs. Release snapshot and SBOM owners combine it with outer bundle inputs so embedded Ajv helpers and `fast-deep-equal` retain package identity; compiler-only dependencies leave the runtime inventory. Exact reviewed package membership remains required.

Generation exclusively acquires one fixed `.generation` stage, writes four files and renames outputs. Only its owner cleans that stage. An occupied stage blocks another generator; removal requires confirming no generator remains active. Interrupted output sets fail exact source/content validation. Manifest input is capped at 256 KiB, each generated JavaScript file at 16 MiB and source inventory at 1,024 paths. Linked output files or generated directories are rejected. Artifacts contain no absolute workspace paths, timestamps or request bodies.

Package builds generate before TypeScript compilation; Vitest verifies or regenerates once before source imports. CLI, Hub and Node bundle owners require a current exact set. Missing or stale artifacts cannot trigger runtime compilation. Ordinary package, Hub and terminal consumers retain the complete map.

The internal shared CLI/Node distribution embeds twelve selected validators in ESM and synchronously loads the complete canonical map from `repository-runtime-validators.cjs` on first unselected lookup. Invalid selected input never retries through fallback. Both files remain required members of the complete runtime inventory. Missing or corrupt fallback fails the operation. First loading belongs to whole-process accounting; there is no public SDK, runtime compiler, request-value cache, code-cache generation or V8 flag change.

### Owned coordinate parsing

`parseEventWriterCoordinateJson` owns JSON parsing and returns a schema-valid coordinate or null; malformed JSON retains its original syntax error. Only the internal shared CLI/Node build replaces this parser's private validation import with generated coordinate branches, matching the importer exactly. Ordinary package, Hub and terminal paths retain the full map. The terminal's unchanged 8 MiB limit excludes the additional branch representation there.

The branch compiler accepts only schema metadata plus a root `oneOf` containing six object branches requiring distinct integer `selectedEventSchemaVersion` constants 1–6. Missing or overlapping discriminators, unsupported shapes or extra root constraints stop generation. The `coordinateData` manifest descriptor binds exact versions, digest and size. This permits validation of one complete applicable branch without constructing unrelated branch errors.

Arbitrary-object `validateSchema` and `readEventWriterCoordinate` retain full validation and error contracts. Only the private file reader uses owned parsing after bounded, no-follow, stable reads. Syntax/schema distinctions, expected-project checks, reader capability evidence, activation identity and cloning remain intact. The post-schema continuation stays private. Valid bytes alone grant neither authority nor a receipt.

Compiler, keyword adapter, generator and artifact-verification changes require reviewed release intent because they can change distributed behavior. Terminal minification preserves the 8 MiB bound; function names are not a separate contract. CLI, Hub and Node bundle formatting remains unchanged.

### Failures and evidence limits

The change adds no event, repository state, user configuration or telemetry claim. Failure codes include `schema_validator_source_limit`, `schema_validator_source_invalid`, `schema_validator_artifact_invalid`, `schema_validator_artifact_stale`, `schema_validator_artifact_limit`, `schema_validator_selection_invalid` and `schema_coordinate_discriminator_invalid`. Filesystem, parsing and compilation failures stop the build. Aggregate artifact checks reject missing or changed distribution members before installation.

Required verification includes exact-error differential comparisons across the catalog and fixtures, exact selected-function bodies, every-schema distribution lookup and fallback loading, property-key coercion, execution with string code generation forbidden, clean builds and reproducibility across absolute roots. Artifact tests cover links, drift, missing members and coordinate-version mismatch. Parser comparisons cover all six versions, malformed nested JSON, file guards and rejected branch proofs; parser-only shared bundles must not import the full map.

These checks do not qualify end-to-end performance. Full regression, package boundaries, release metadata, supported installed consumers and exact terminal size remain required. Diagnostics must bind new executable bytes and preserve earlier results. Startup improvement does not close frozen resource gates, reviewed real-task quality, production rollout or operational observation requirements.

## Strong-commit resource accounting

[ADR-0506](../../decisions/execution/verification/0506-separate-platform-commit-cost-from-recording-gates.md) preserves `synchronous=FULL`, `fullfsync=1`, `checkpoint_fullfsync=1`, both full report reads and fresh guards. Its source reports Darwin arm64 observations of one WAL `F_FULLFSYNC` per publication commit, 3.0–6.3 ms across 32 installed workers, and 7.65 ms added by a plain SQLite process committing to an existing database. These observations are platform-specific evidence, not measurements performed here.

`context-quality-packaged-resource-v2` retains workloads and thresholds and fixes `durableCommitAllowanceMs` at 5 through its validator. The canonical active worker counts each `COMMIT` on connections enabling `fullfsync`. Every candidate sample, including warmups, must show at least one strong commit; control workers must show none. Missing candidate commits or control commits fail evidence validation.

Added latency subtracts one 5 ms allowance from each paired sample mean. Whole-process accounting subtracts one allowance per sample from candidate process time before calculating the ratio. Only one required commit per sample receives an allowance; any extra commit caused by a split batch is charged in full. Every group also reports raw latency and process intervals. CPU receives no allowance. CPU, RSS, state growth, parity, integrity, full reads and current guards keep their prior requirements.

`context-quality-packaged-resource-v3` retains v2 rules and raises cold pairs from five to thirty. Approval followed the known v2 result, whose 12 KiB cold CPU upper bound was 1.266. That failure remains recorded; v3 constitutes a new cohort and changes no acceptance threshold.

Earlier protocol results keep their original meaning. The allowance does not establish device latency, power-loss durability or other-platform behavior. A different platform or storage contract needs fresh commit observations before reusing 5 ms. Removing the approximately 9 ms exit WAL checkpoint remains outside this decision because sidecar retention has active-writer meaning in maintenance paths.
