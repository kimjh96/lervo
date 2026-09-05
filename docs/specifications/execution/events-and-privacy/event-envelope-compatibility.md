# Event envelope compatibility

The shared reader accepts envelope schema versions 1 and 2 and preserves valid mixed hash chains without rewriting their bytes or meaning. Version 1 remains the default writer; activated managed execution writes version 2.

A supported but malformed envelope is `event_invalid` at the event-contract boundary and an integrity failure where stored bytes are decoded. An unknown integer envelope version is `event_schema_unsupported`; local storage, sync, and Hub intake reject it before mutation. Invalid hashes and payload allowlists remain integrity failures, not unsupported-version failures.

## Version 2 payload contracts

Envelope version 2 makes these contracts readable. FH1 emits the causal contract, FH2 emits managed resource observations, and FH3 emits bounded managed and direct-terminal stage observations.

### `work.causality.recorded`

Retains opaque work, run-relationship, attempt, workstream, assignment, and agent coordinates. The payload schema discriminates root, retry, and other child shapes. Before provider startup, it enforces one event per run, one root per work, existing same-work parents, exact retry ordinals, acyclic ancestry, and idempotent recovery. Deliberation uses one control root with role and publication-evaluation children.

### `resource.usage.recorded`

Retains an opaque observation and source digest, scope, source, accounting mode and descriptor hash, status, bounded counters, and reason code. Counts are non-negative; cached input cannot exceed input, reasoning output cannot exceed output, and total equals input plus output. `unavailable` and `invalid` contain no fabricated usage.

Provider identity and native counter semantics remain in a canonical local CAS descriptor, not this event. Descriptor-storage failure creates no dangling resource observation.

### `execution.stages.observed`

Retains managed or unmanaged mode, an opaque work or terminal coordinate, nullable managed work ID, nullable terminal hook, observation and environment digests, repository profile, and at most 32 catalogued stage results. Current managed producers use a null terminal hook; current direct producers use `UserPromptSubmit` or `Stop`. Historical sets without this additive field remain readable but project with an unavailable hook coordinate.

The canonical local CAS environment profile contains build, nullable adapter and provider, OS, architecture, Node, corpus counts when observed, cache state, and concurrency. It excludes paths, prompts, queries, outputs, credentials, and vendor span names.

## Validation and evidence boundaries

All three payloads use exact top-level allowlists. Resource counter names are the only approved token-like nested keys. Schema, discriminator, arithmetic, or privacy failure prevents sync acceptance and creates no observation success.

Missing resource or stage events mean `unobserved`, not zero usage or successful stage measurement. A requested historical run without a causal event is `legacy_unlinked`; missing ancestry is never reconstructed from correlation.

Managed stage-profile persistence fails before provider startup. A direct version 1 writer skips version 2 stage evidence without blocking the hook. Direct measurement or persistence failure emits no false stage success and leaves terminal coverage partial or unavailable; it does not erase or reinterpret a valid context or turn event.

Exact observation-set duplicates are idempotent. Contradictory IDs, invalid trees, duplicate hook sets, and cross-run or cross-session joins make the projection invalid.
