# Native synchronization in standalone runtime distributions

Status: `source_implemented_full_consumer_smokes_blocked`
As of: 2026-10-10

[ADR-0502](../../decisions/distribution/0502-bind-native-sync-assets-to-standalone-runtime-distributions.md) connects the [native synchronization source](context-quality-native-sync-implementation.md) to standalone Hub and Node bundle/distribution owners. CLI npm and repository-installed terminal-hook integration remain unfinished.

## Implemented boundaries

The shared artifact adapter validates the exact pair of files, non-linked regular entries, bounded sizes, manifest/API/Node-API coordinates, complete source identity and actual universal Mach-O slice headers. It copies validated bytes through an owned staging directory, restores the prior directory on publication failure and preserves recovery bytes if rollback fails. It refuses foreign output entries. Missing optional support may remove only the prior owned pair; required or partially declared support fails before replacement.

The source digest now includes the C sources, build script and shared artifact owners. On non-Darwin builds, a supplied addon must match those current sources; absent support still allows ordinary local execution. Native compilation remains build-only. The current universal binary is unchanged at 85,192 bytes and `sha256:72f477a8f4c4f88c859519e78a8a75b6a409d35a52ef7667cd18a0abeb810f75`. Its current source identity is `sha256:e156de928dfdb726cf50e82ec6fe9363dfda3ce47588fca5d14a597818c65ec8`.

Hub and Node bundles now receive the exact pair beside `bin.js`. Darwin archive builders require and copy those assets; other target archives omit them. Version-2 distribution manifests require the native pair on Darwin and reject partial or unexpected native inventories. Version-1 archive compatibility remains. The sidecar schema remains version 1. SBOM file components bind both byte digests and dependency edges from the application; archive verification checks the inner native identity and SBOM after its outer hashes and inventory.

A matching-platform native smoke runs in a child against temporary synthetic files. Eligible files exercise native synchronization; unsupported topology exercises ordinary fallback. Neither mode claims hardware power-loss certification. Cross-host JavaScript smoke remains separate from target-native execution. CAS format, event schema, writer authority, fresh bindings and durability gates are unchanged.

Pure Hub/Node manifest contracts and the shared SBOM renderer are separated from archive I/O. The existing facade imports remain compatible. The Node archive module is now below the long-module threshold, so its obsolete structural-review entry is removed rather than refreshed to excuse mixed responsibilities.

## Observed verification

The artifact, archive, distribution, native kernel/lifetime, CAS and release-intent suite passes 82 cases in thirteen files. Artifact tests cover exact copying, stale-source and binary drift, missing/partial assets, directory/file links, foreign destination contents, publication rollback and retained recovery after rollback failure. Universal-header tests reject duplicate CPUs, overlaps, truncated slices, mismatched CPU labels and non-bundle slices. SBOM tests reject missing dependency edges.

Synthetic archive tests independently package both runtime formats and verify extracted native bytes. They reject changed native content, missing native SBOM components and absent version-2 Darwin capability, and accept legacy version-1 archives. These fixtures validate archive contracts, not application service readiness. The initial Hub fixture omitted its already-required README; that test fixture was corrected and the failure retained.

The filesystem-durability, Hub and Node builds pass. Three direct asset probes load the identical source-bound binary from the package and both bundle directories on Darwin arm64 with Node 26.5.1; all return native synchronization success. This does not establish minimum-Node or x86_64 execution. Only Node 26.5.1 is present in the inspected local Node installation.

A separate bundled CAS consumer test passes on this host. It disables ordinary `FileHandle.sync`, then writes and verifies four different CAS objects with the adjacent native pair. Removing the pair makes the same consumer take ordinary synchronization and fail at the deliberate test guard, proving the positive case did not silently use fallback. The initial test could not resolve an undeclared root-level esbuild dependency; it now resolves the existing Hub build owner's dependency without adding a package or changing the lockfile. After the bounded staging follow-up, the combined suite passes all 83 cases across fourteen files.

Full distribution smoke commands were attempted without weakening their behavior. The Hub attempt is blocked when the sandbox rejects `listen(127.0.0.1)` with `EPERM`. The Node attempt is blocked by `ERR_PNPM_NO_OFFLINE_TARBALL` for the required Claude Agent SDK in the configured offline store. Both commands fail, their diagnostics are retained, and no successful full consumer installation is claimed. The native checks and synthetic archive tests do not replace those smokes.

Final quality, architecture, documentation lifecycle and diff checks pass: sixty long-module reviews, 737 script modules, 103 production package boundaries and 539 lifecycle documents. Reviewed minor intent is `relint_fa0e63f7a0ec65fe2f880437`; task-base release completion remains `intent_pending`, not release readiness. The complete current runtime archive contains 2,603 files and 42,876,483 bytes, with native-inclusive identity `sha256:1791a7063057af9e766e22c773cb20ac9ad7117d9ad1a4f9dd3f2fa80028d774`. The earlier source-cohort runtime remains separately archived and unchanged.

## Remaining acceptance

Rerun full standalone build/verify/install/service smokes in an environment with loopback listening and the complete existing dependency closure. Complete CLI release archive/SBOM/packed-consumer ownership, installed terminal-hook copying and an exact source-bound cross-platform CI handoff. Verify minimum supported Node and x86_64 execution, then run a new distributed-artifact resource cohort. Prior source-only results remain tied to their archived runtime; no unchanged-build or new performance claim follows from this packaging change.

Both cold latency and all eight CPU gates remain open, alongside reviewed real-task families, both-provider outcomes and reader-first installed recovery/cohort acceptance. No remote installation, service activation, provider call, release publication or production writer activation is part of this slice.

Native build/copy staging uses one fixed owned directory per output. Exclusive directory creation prevents a second copy from replacing an active or retained recovery stage. Ordinary failure cleans its owned stage; rollback failure or process interruption retains it and stops later attempts until recovery is resolved. Repeated attempts therefore cannot accumulate recovery directories.
