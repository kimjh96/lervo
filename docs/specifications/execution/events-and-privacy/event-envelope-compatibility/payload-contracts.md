# Version 2 payload contracts

Envelope version 2 makes these contracts readable. FH1 emits the causal contract, FH2 emits managed resource observations, and FH3 emits bounded managed and direct-terminal stage observations. Root-agent liveness later adds a fourth v2-only contract without changing the immutable v1 type catalog.

All contracts follow the [validation and evidence boundaries](validation-and-evidence.md).

## `agent.liveness.observed`

Retains the root-agent ID and exact revision, reporting provider, a domain-separated provider-session digest, and observation time. Excludes the raw provider session, process ID, command, prompt, output, path, credential, and unrestricted error. Recording requires an explicitly activated v2 writer.

The event represents one accepted report, not continued provider-process health or authenticated process identity. Missing, old, or revision-mismatched evidence grants no authority and never releases an agent, assignment, or workspace writer.

## `work.causality.recorded`

Retains opaque work, run-relationship, attempt, workstream, assignment, and agent coordinates. The payload schema discriminates root, retry, and other child shapes. Before provider startup, it enforces one event per run, one root per work, existing same-work parents, exact retry ordinals, acyclic ancestry, and idempotent recovery. Deliberation uses one control root with role and publication-evaluation children.

## `resource.usage.recorded`

Retains an opaque observation and source digest, scope, source, accounting mode and descriptor hash, status, bounded counters, and reason code. Counts are non-negative; cached input cannot exceed input, reasoning output cannot exceed output, and total equals input plus output. `unavailable` and `invalid` contain no fabricated usage.

Provider identity and native counter semantics remain in a canonical local CAS descriptor, not this event. Descriptor-storage failure creates no dangling resource observation.

## `execution.stages.observed`

Retains managed or unmanaged mode, an opaque work or terminal coordinate, nullable managed work ID, nullable terminal hook, observation and environment digests, repository profile, and at most 32 catalogued stage results. Current managed producers use a null terminal hook; current direct producers use `UserPromptSubmit` or `Stop`. Historical sets without this additive field remain readable but project with an unavailable hook coordinate.

The canonical local CAS environment profile contains build, nullable adapter and provider, OS, architecture, Node, corpus counts when observed, cache state, and concurrency. It excludes paths, prompts, queries, outputs, credentials, and vendor span names.
