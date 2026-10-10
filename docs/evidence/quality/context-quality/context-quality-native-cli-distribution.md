# Native synchronization in CLI release artifacts

Status: `source_implemented_generated_metadata_and_hosted_acceptance_pending`
As of: 2026-10-10

[ADR-0502](../../../decisions/distribution/0502-bind-native-sync-assets-to-standalone-runtime-distributions.md) now covers CLI packaging and same-workflow native artifact transfer in addition to the [standalone integration](context-quality-native-standalone-distribution.md). Repository-installed terminal-hook copying and full resource qualification remain open.

## Implemented contracts

The CLI bundle copies the source-bound universal Darwin addon and its manifest beside its three JavaScript executables. The npm allowlist and actual archive contain exactly seven files including README and package metadata. Release snapshot generation requires the native pair, validates its current source identity and actual Mach-O slices, and writes schema 6. Manifest readers still accept schema 5. SBOM generator version 2 includes both native file hashes and application dependency edges; schema-5 generation retains its earlier representation.

Built and packed consumer checks compare both files with the verified source build and request an actual native probe on Darwin. Linux and Windows carry the identical pair but retain runtime platform fallback. A package being present does not prove native execution on an unsupported host. Generated manifest and SBOM files remain exclusively owned by their existing update commands.

Full Code quality and CLI release matrix workflows each have one macOS producer. Its receipt binds source revision, workflow, run ID, producer attempt, current source digest and exact pair digest. Consumers validate before replacing generated assets and accept an earlier producer attempt only within the same workflow run and revision. The three-day artifact contains only public native assets and receipt. It grants no independent provenance claim. Existing LF checkout policy prevents Windows line-ending drift in hashed sources.

The build reuses an already verified source-bound pair on macOS as well as other platforms. Fresh builds compile only on macOS. An empty directory left after compiler failure can be retried; malformed or partial declared assets fail. Release preparation now runs on macOS. Source-bound handoff guarantees exact bytes within a workflow; reproducibility between fresh workflow producers remains to be verified. Changed compiler output must fail the committed release inventory check rather than update approved hashes implicitly.

Module review keeps the archive allowlist and native SBOM mapping pure, consumer verification separate from packaging, and transfer effects behind its dedicated adapter. Entrypoints only parse or compose owner operations. No new runtime event, provider dependency, durability exception, long-module waiver or production writer activation is introduced.

## Observed local verification

The corrected release, transfer and CI-contract suite passes 166 cases across 35 files. The native artifact/archive/bundle, filesystem-durability and CAS regression suite passes another 62 cases across eleven files. Together these are 228 distinct cases across 46 files. Tests cover schema-5 compatibility, complete schema-6 inventories, native SBOM hashes and edges, source/run/digest mismatch before replacement, same-run retries, compiler-free reuse and repeatable fresh compiler failure. Existing workflow expectations were updated to include the new dependency and restore step after the first broad run identified two stale assertions; the original failure log is retained.

A real CLI pack and extraction contains exactly seven files. The extracted addon performs native synchronization on Darwin arm64 with Node 26.5.1. Independent binary corruption and missing-manifest probes are rejected. The initial probe omitted creation of its temporary extraction directory and failed before extraction; its corrected run and original failure are both retained. This probe does not install the external dependency closure or establish complete CLI journeys.

Filesystem-durability, CLI, Hub and Node builds pass. The current native source identity is `sha256:fc1fda095f057bbbf379fed5277df2be6de9338ccec71240067cffbf1c05ab70`; binary identity remains `sha256:72f477a8f4c4f88c859519e78a8a75b6a409d35a52ef7667cd18a0abeb810f75` at 85,192 bytes. The complete native-inclusive runtime identity is `sha256:3027dc58c3c3a51ff63c887ea048e6492176d1882f34b75f7a4823713dff7b09`, archived with 2,605 files and 42,961,995 bytes. Earlier runtime archives and measured cohorts remain separate; no performance result is attributed to this new build.

The release manifest update command was attempted and failed during its required offline deployment because the configured store lacks `zod@4.4.3`. It did not rewrite the generated manifest or SBOM, which remain schema 5 and are not current for this candidate. The earlier full Hub smoke remains blocked by sandbox loopback `EPERM`; the earlier Node smoke lacked its required SDK tarball. These gates are neither bypassed nor reported as passed. Reviewed minor intent is `relint_87a2a834cc9c04c8b9003db5`; base-bound completion remains `intent_pending`, not release readiness.

## Remaining acceptance

Complete repository-installed terminal-hook asset ownership and use the complete existing dependency store to run the manifest/SBOM owners and full installed consumers. Verify hosted Linux/macOS/Windows transfer, exact output across fresh workflow runs, minimum Node and x86_64 execution. Then register a new distributed-artifact resource cohort. Both cold latency and all eight CPU gates remain open; reviewed real-family quality, both-provider outcomes and reader-first installed recovery/cohort acceptance are unchanged.

No hosted workflow was dispatched and no remote install, service activation, provider call, publication, tag, commit or push occurred in this slice. The private review packet is excluded from source/runtime archives and retains its existing expiry.
