# ADR-0295: Authorize typed-context managed canary v14

Status: `accepted`
Date: 2026-08-29

## Context

ADR-0294 prepared typed-context v13 manifest `sha256:37383ba8a8eff8fd327627e392336371fbe2cedffb5a7665c401aa2e9083b3d7` with eight Codex tasks, eight Claude tasks, zero selection calls, zero provider calls, and no execution authority. Its entrypoint exposed no authorization or execution operation.

The user reviewed that exact scope and directed execution. Because adding the execution entrypoint changes repository bytes, immutable v13 is source-stale for live use. A fresh successor must bind authorization and the fail-first operation before any call.

## Decision

Prepare v14 with the exact v13 population, ordering, typed document-role contract, native signed-in provider arms, and unchanged recall and precision gates. Bind the v13 contract and prepared-manifest digests as the preparation predecessor. Bind exact typed-boundary, preparation, authorization, native-task, and v14 entrypoint source digests, plus the current built CLI digest.

After provider-free verification and knowledge refresh, authorize only the exact v14 prepared-manifest digest under the user's explicit direction. Execute one scheduled task at a time. Persist its owner-only attempt before the provider call and its bounded terminal observation afterward. Revalidate source and build before every task. On technical failure, persist `task_execution_failed` and stop all later calls without retry, repair, replacement, or fallback.

The ceiling is eight Codex `gpt-5.6-sol` calls and eight Claude `opus` calls. Selection calls, API keys, concurrent calls, writes, external messages, Hub effects, operational-search changes, and production activation remain prohibited.

## Evidence, privacy, and failure meaning

Reuse the owner-only `authorization.json`, per-run `attempts/*.json`, and `linked_evidence_managed_canary_observation.v2` records. Add no event or state schema.

Authorization records contain only checkpoint, digest, time, provider counts, ceilings, and boolean authorities. Attempts contain only bounded run coordinates and start time. Observations contain provider and model identifiers, duration, provider-reported usage, counts, exact document IDs and content hashes, recall, precision, verification and publication status, repository-status digests, and bounded failure codes.

Records exclude prompts, paths, titles, source bodies, result bodies, credentials, raw provider errors, and billing data. `task_execution_failed` means the task produced no eligible completed observation. It does not identify provider fault, permit retry, or imply that no external provider effect occurred after the attempt was persisted.

## Consequences

The paired experiment can measure the typed boundary across both providers without user API keys. Results remain evaluation evidence only. Passing gates cannot activate the feature; failing gates preserve default-off behavior. Provider-reported token totals are not directly comparable billing measurements.

## Verification

- Prove exact equality with the v13 population, ordering, roles, and acceptance gates.
- Verify every bound source digest, the built CLI digest, owner-only prepared manifest, and exact authorization replay.
- Verify attempt-before-call persistence, sequential execution, the 16-call ceiling, zero selection calls, no retries, and source/build revalidation before every task.
- Stop after the first technical failure; otherwise complete all 16 observations and calculate provider metrics independently.
- Run quality, documentation, knowledge, full-repository, and exact-base release-completion checks after reporting.

## References

- [Typed-context v13 preparation](../0294-prepare-typed-context-managed-canary-v13.md)
- [Prior exact execution pattern](../0285-authorize-exact-key-free-managed-canary-v6.md)
- [Managed canary specification](../../../../../specifications/execution/managed-linked-evidence-canary.md)
