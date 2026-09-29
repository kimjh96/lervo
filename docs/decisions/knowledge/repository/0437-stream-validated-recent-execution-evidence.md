# ADR-0437: Stream validated recent execution evidence

Status: `accepted`
Date: 2026-09-28

## Context

The installed Lervo event chain contains 29,373 events and verifies successfully. Its 17,463 execution events occupy 16,802,742 canonical bytes. The complete adapter's 16 MiB limit is exceeded at sequence 29,331. Node configuration open consequently fails before conversation readiness. Other installed repositories remain ready.

Interactive context already selects the latest 4,096 execution events by sequence, but only after collecting the complete corpus. This makes the complete-history capacity limit an unintended prerequisite for live conversation startup.

## Decision

Give interactive context an independent streaming adapter. Verify the canonical event store before and after visiting one immutable sequence-bounded snapshot. Validate every execution event encountered against its schema, hash, payload privacy allowlist, and existing 256 KiB per-event bound, including old events outside the returned window. Keep only the most recent execution events within both the requested count and 16 MiB retained-content bound. The count must be a positive safe integer at most 32,768; interactive callers continue to request 4,096. The transient queue retains at most twice the window count and byte bound before compaction. The adapter never writes events or artifacts.

Keep the complete adapter's existing count, sequence, byte, privacy, and integrity limits. Share event selection and canonical validation through an internal module; neither adapter depends on a provider. The interactive projection is rebuildable and covers a recent window only. It cannot establish complete-history coverage, settle debt, authorize document writes, or prove global knowledge currency. It keeps the existing source representation and adapter identity because each returned event remains its unchanged canonical original.

Missing snapshot pages, invalid event envelopes, altered hashes, unsafe payloads, invalid per-event sizes, or a failed store integrity check fail closed with `knowledge_evidence_source_invalid`. The diagnostic excludes event bodies, prompts, paths, and native errors. Invalid caller bounds are configuration errors. No event, durable state, writer schema, authority, or provider allowance is added.

## Consequences

Valid history growth no longer prevents interactive startup merely because the complete corpus exceeds its independently reviewed memory bound. Validation still reads the history through the snapshot boundary; this decision does not promise constant validation time.

Complete-history compilation still requires a separately reviewed archive, pagination, or compaction contract before it can cross the existing limit. Raising the limit, dropping historical originals, or treating recent-window success as complete compilation would not solve that requirement. The background convergence roadmap retains this open acceptance condition.

## Verification

Regression coverage uses 33,000 execution events: the complete collector refuses the corpus, while the streaming projection returns the exact last 4,096 originals. Old unsafe evidence still fails validation after leaving the retained window. Broken integrity, incomplete snapshot pages, empty stores, and invalid window bounds have separate assertions. Installed recovery must confirm a fresh health PID matching the service and actual conversation readiness before being claimed.

The existing v18 canary boundary is reviewed again after extracting validation. Its complete collector and new internal validation module are both content-bound. Only these source bindings and the checkpoint's reviewed digest change; historical observations, provider authority, populations, retention, and all acceptance gates remain intact. This review does not authorize a native canary run or turn an interactive window into complete evidence.

## References

- [Complete execution-event capacity](0403-expand-execution-event-source-capacity.md)
- [Background convergence roadmap](../../../roadmap/knowledge/autonomous-background-convergence.md)
