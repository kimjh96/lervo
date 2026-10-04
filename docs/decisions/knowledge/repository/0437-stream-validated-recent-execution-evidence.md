# ADR-0437: Stream validated recent execution evidence

Status: `accepted`
Date: 2026-09-28

## Context

The installed Lervo event chain verifies successfully with 29,373 events. Its 17,463 execution events occupy 16,802,742 canonical bytes, exceeding the complete adapter's 16 MiB limit at sequence 29,331. Node configuration open therefore fails before conversation readiness; other installed repositories remain ready.

Interactive context selects the latest 4,096 execution events by sequence only after collecting the complete corpus. Complete-history capacity consequently becomes an unintended prerequisite for live conversation startup.

## Decision

Give interactive context an independent streaming adapter. Verify the canonical event store before and after visiting one immutable, sequence-bounded snapshot. Validate every encountered execution event against its schema, hash, payload privacy allowlist, and existing 256 KiB per-event bound, including historical events outside the returned window.

Retain only the most recent execution events within both the requested count and a 16 MiB retained-content bound. The count must be a positive safe integer no greater than 32,768; interactive callers continue to request 4,096. Before compaction, the transient queue retains at most twice the window count and byte bound. The adapter never writes events or artifacts.

Keep the complete adapter's existing count, sequence, byte, privacy, and integrity limits. Share event selection and canonical validation through an internal module; neither adapter depends on a provider. The interactive projection is rebuildable and covers only a recent window. It cannot establish complete-history coverage, settle debt, authorize document writes, or prove global knowledge currency. Preserve the source representation and adapter identity: every returned event is its unchanged canonical original.

Missing snapshot pages, invalid event envelopes, altered hashes, unsafe payloads, invalid per-event sizes, and failed store integrity checks fail closed with `knowledge_evidence_source_invalid`. Diagnostics exclude event bodies, prompts, paths, and native errors. Invalid caller bounds are configuration errors. Add no event, durable state, writer schema, authority, or provider allowance.

## Consequences

Valid history growth no longer prevents interactive startup merely because the complete corpus exceeds its independently reviewed memory bound. Validation still reads history through the snapshot boundary; constant validation time is not promised.

Complete-history compilation requires a separately reviewed archive, pagination, or compaction contract before crossing the existing limit. Raising the limit, dropping historical originals, or treating recent-window success as complete compilation does not satisfy that requirement. The background convergence roadmap retains this open acceptance condition.

## Verification

Regression coverage uses 33,000 execution events: the complete collector refuses the corpus, while the streaming projection returns the exact last 4,096 originals. Old unsafe evidence fails validation even after leaving the retained window. Broken integrity, incomplete snapshot pages, empty stores, and invalid window bounds have separate assertions. Claim installed recovery only after confirming a fresh health PID matching the service and actual conversation readiness.

Review the existing v18 canary boundary again after extracting validation. Both its complete collector and the new internal validation module are content-bound. Only those source bindings and the checkpoint's reviewed digest change; historical observations, provider authority, populations, retention, and every acceptance gate remain intact. This review neither authorizes a native canary run nor makes an interactive window complete evidence.

## References

- [Complete execution-event capacity](0403-expand-execution-event-source-capacity.md)
- [Background convergence roadmap](../../../roadmap/knowledge/autonomous-background-convergence.md)
