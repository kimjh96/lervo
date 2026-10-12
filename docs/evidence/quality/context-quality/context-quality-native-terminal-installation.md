# Native synchronization in installed repository terminal hooks

Status: `source_implemented_local_installed_fixture_verified`
As of: 2026-10-10

The owner resumed work after restarting WSL. The registered Windows target is online and SSH reports Ubuntu running. All 389 paths from the preceding [CLI integration](context-quality-native-cli-distribution.md) backup were present and byte-identical before this work. No remote installation or service configuration was changed.

## Implemented boundaries

[ADR-0502](../../../decisions/distribution/0502-bind-native-sync-assets-to-standalone-runtime-distributions.md) extends the terminal runtime installer with the exact native pair. The CLI reads its packaged assets; installation checks bounded regular files, exact native manifest coordinates and the binary digest without loading code. Release verification still owns source-build and universal Mach-O qualification. Ordinary non-Darwin source builds may retain the existing no-native fallback when the optional directory is absent; released archives must contain the pair.

The repository runtime manifest uses schema 2 and binds both fixed native paths, byte counts and SHA-256 hashes alongside JavaScript. A generated-only plan includes desired asset hashes, observed prior asset hashes and the prior outer-manifest hash. Native-only changes are therefore independently bound even when JavaScript is unchanged. Serializable plans exclude all binary payloads. User-owned provider settings keep their existing exact-approval boundary.

The durable materialization owner now accepts generated binary files, snapshots their mutable buffers before awaited effects, and uses raw-byte hashing, staging, synchronization, publication and rollback through the existing journal. No new journal format or unbounded history is introduced. Terminal integration was split into contract, provider merge, bounded file reading, native asset validation, runtime inventory and orchestration owners. Its obsolete long-module review was removed; the remaining transaction owner was structurally reviewed without a new exception.

Hook startup checks the complete inventory before input. Missing, linked, changed or undeclared native files and JavaScript BOM tampering are rejected. Schema-1 runtimes without assets remain valid; a legacy plan cannot silently retain native files it does not declare. The native pair replaces two bounded generated files in place. Existing terminal event fields remain unchanged: the JavaScript hash keeps that meaning, while the plan ID binds the complete transition.

Adverse tests exposed two existing recovery gaps: terminal plan IDs were absent from journal validation, and the CLI recovery command only looked for semantic materialization events. The journal now admits the existing terminal namespace. Recovery scans canonical semantic and terminal application events across pages, preserving outputs after the exact success event and rolling back before it.

## Observed verification

The combined terminal installation, durable recovery, materialization settlement, workspace recovery, CLI and history suite passes 65 cases across seven files. Fourteen asset cases cover exact binary copying, generated-only upgrades, stale native plans, rollback after each published file, interruptions before and after the event, missing files, symlinks, undeclared assets and byte-level JavaScript tampering. History tests cross the first 1,000-event page and reject unrelated observations or plan IDs.

A separate test installs the actual built terminal executable and native pair into a disposable initialized repository. The installed addon performs native synchronization on Darwin arm64 with Node 26.5.1. Both Codex and Claude entrypoints return their normal empty JSON response from a repository subdirectory; corrupting the installed native binary makes both exit 2 before input processing. This is a manual fixture invocation, not provider acceptance, provider use, an external model call or full outcome qualification. The initial fixture incorrectly expected an empty string instead of the contract's empty JSON object; the corrected fixture passes and the original failure is retained. Combined evidence is 66 distinct tests across eight files.

Workspace typechecking, the complete workspace build, quality and architecture checks pass. The initial typecheck found a text-only test helper calling `includes` on the new string-or-binary union; that fixture now narrows to text. Structural checks cover 59 long modules and 745 script modules; architecture checks cover 103 production packages. `lervo migrate knowledge --json` produces a ready plan with 1,747 operations and no blockers; that broader plan was inspected, not applied as a side effect of native installation. Knowledge lint reports valid with 144 issues, including stale normalization warnings, so it does not establish complete documentation currency.

The full current runtime contains 2,611 files and 42,982,818 bytes, with native-inclusive identity `sha256:4a91efb4fb1470ecdfa0102cc70031eedb6de74bc7dd9ad5f72baa21076df889`. The native source and binary identities remain unchanged from CLI integration. Earlier complete runtime archives and measured cohorts are preserved; no benchmark result is transferred to this new JavaScript build. Reviewed minor intent is `relint_cfdec9b4e12bdfd1c434aeca`. Base-bound release completion remains `intent_pending`, not readiness.

## Resumed distribution verification

The resumed environment permits the previously blocked owners and consumers. The release manifest and SBOM were regenerated by their existing commands; checks pass for schema 6, seven archive files, 100 portable dependencies, 226 SBOM components and 111 dependency nodes. The lockfile remains byte-identical to the preceding backup. All 138 release tests across 31 files pass after regeneration. The local unsigned statement check passes for three subjects; this is not a signed or published attestation.

The full built CLI, Hub and Node checks, standalone Hub and Node distribution smokes, and packed CLI consumer check pass on this Darwin arm64 host. The packed suite verifies context-quality events, capability execution, live triggers, unattended scheduling, dynamic topology, deterministic cross-provider continuation and product-host protocol v11. The isolated local registry preflight also publishes the package, verifies metadata and tags, installs it as a consumer and rejects conflicting publication. These are disposable installed fixtures, not the production fleet, a public registry publication or a real-provider quality cohort.

An official Node 22.13.0 arm64 archive was downloaded to a temporary directory and checked against the release SHA-256 list. The same native bytes pass seven minimum-Node tests covering loader behavior, executing-Worker teardown and installed hook verification; the full built CLI smoke also passes under that executable. These cases overlap existing tests and are not added as independent source cases. Local x86_64 execution is unavailable because the host lacks Rosetta; universal headers remain insufficient evidence for that target.

## Remaining acceptance

Complete hosted Linux/Windows/x86_64 and fresh-workflow byte verification, and bind the next performance worker to the verified distribution without changing the measured scope or thresholds. The earlier offline and loopback failures are preserved as historical evidence, but no longer block the completed local checks. A new distributed-artifact cohort must still qualify both cold-latency and all eight CPU gates. Human-reviewed families, unseen held-out tasks, both-provider outcomes and reader-first installed recovery/cohort acceptance remain open.

No production writer was activated, and no hosted workflow, deployment, publication, tag, source commit or push was performed. Private review data was not copied into backups; its existing expiry remains unchanged.
