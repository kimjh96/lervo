# ADR-0498: Prepare fresh knowledge reads in order

Status: `accepted`
Decision date: 2026-10-09
Amends: [ADR-0413](../../search/engines/0413-close-product-default-lexical-v2-surface-gaps.md)

## Context

After event preparation improved under [ADR-0497](../../operations/storage/0497-reuse-exact-event-page-verification.md), repository preparation still took about 2.5 seconds. Profiling found repeated exclusion-pattern construction during scanning and serialized reads of concept sidecars and publications. Prepared queries were already a small fraction of the cost.

The owner requires structural improvements while retaining every eligible source and source unit. Neither reduced retrieval coverage nor weaker freshness checks is an acceptable optimization.

## Decision

Compile the current exclusion patterns once per scan attempt. The matcher preserves the existing wildcard, directory-root, and transient-tool-cache semantics. A subsequent scan compiles its current policy again. Source discovery, safe byte reads, file and byte limits, extraction, source identity, and snapshot hashing retain their existing behavior.

Read concept sidecars and query publications with an operation-local scheduler. Up to eight independent reads may be in flight, and every input is processed. This is an I/O scheduling width, not an inventory or result limit. Parse and validate each completed concept read without retaining the raw YAML corpus. Return values in original registry order so duplicate reconciliation, ranking ties, and sidecar-set hashes remain deterministic. Query sidecar hashing uses the same scheduler instead of opening a descriptor for every sidecar at once.

Each publication still receives all existing root, ancestor, symbolic-link, file-type, size, before/after descriptor, UTF-8, and content-hash checks. Every preparation reads current bytes. No timestamp-only reuse, persistent cache, or retained document body is introduced. Known invalid publications retain the existing omission behavior; invalid concept sidecars retain their recorded errors. An unexpected scheduling failure drains in-flight reads before rejecting and never returns partial success.

Separate pure source classification, source-unit materialization, and immutable scan transforms from filesystem scan orchestration. Keep the existing scanner exports as a compatibility facade. Provider behavior, ranking, public evidence contracts, and source-unit adapter versions remain unchanged.

## State, privacy, and failure meaning

Compiled expressions belong to one scan attempt. Scheduler state consists of input position, ordered results, active promises, and indexed failures for one call. Neither state survives preparation or creates disk records, event types, or provider calls. Existing canonical files remain authoritative. Local observation results contain the same permitted bytes as their sequential predecessors and are not added to telemetry.

## Verification

Compare complete source arrays, units, coverage, snapshot IDs, and complete query results against the pre-slice implementation over identical repository bytes. Run 30 alternating recorded pairs after warmup, including CPU and median/p95 elapsed time. Keep all samples and report the runtime and measurement exclusions.

Regression cases cover complete inputs beyond worker width, reordered completion, drained failures, policy changes between observations, same-size edits with restored timestamps, new and deleted publications, unsafe or malformed publications, and reviewed sidecar precedence. Existing migration, document move/split/merge, source extraction, history filtering, and relation tests remain required.

This decision does not complete the persistent incremental-observation proposal in [ADR-0495](0495-separate-fast-maintenance-status-from-expensive-verification.md), nor establish installed latency or Hit improvement. Delivery evidence belongs to the [maintenance roadmap](../../../roadmap/knowledge/maintenance-recovery-and-speed.md).
