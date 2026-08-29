# ADR-0300: Stop v17 and expand complete-event capacity

Status: `accepted`
Date: 2026-08-30

## Context

Managed canary v17 completed 10 scheduled provider turns and stored each result under the expanded 128-record observation cap. Before the eleventh provider started, managed context preparation verified the isolated repository's complete execution-event source. It contained 4,105 relevant events, nine above the 4,096-event cap, so preparation failed closed with `knowledge_evidence_source_invalid`.

V17 used 10 task calls, zero selection calls, zero API keys, zero retries, and made no repository writes. Ten observations are valid accuracy samples. The failed observation used zero task calls, created no adapter, and contains no usage. The incomplete population cannot authorize activation. Relevant event fields occupy about 3.0 MB, below the independent 16 MiB total-byte cap.

## Decision

Preserve v17 as immutable terminal technical-failure evidence. Do not retry, repair, replace, resume, rescore, or complete its remaining schedule.

Raise the complete execution-event source count cap from 4,096 to 8,192. Preserve the 100,000 sequence cap, 256 KiB per-event cap, 16 MiB total-byte cap, full chain verification before and after traversal, schema and hash validation, payload privacy allowlist, unique event IDs, and fail-closed behavior. Do not delete, truncate, skip, or overwrite historical events.

Prepare a fresh source- and build-bound v18 checkpoint with new run IDs for the unchanged population of eight Codex and eight Claude runs and the unchanged accuracy gates. Bind the v17 terminal evidence, the observed 74 of 128 canary records, and the observed 4,105 of 8,192 relevant execution events. Production activation remains conditional on a terminal passing v18 review.

## Consequences

The failed v17 observation is technical overhead but incurred no provider call. The increased count cap remains bounded by both count and bytes and affects only complete, privacy-validated execution-event knowledge projection. Canonical events remain append-only, and provider behavior remains adapter-neutral.

## Verification

- Bind v17's prepared-manifest and terminal observation-set digests.
- Confirm 10 completed observations, one failed pre-provider observation, 10 task calls, zero selection calls, and no repository writes.
- Confirm 4,105 relevant events and approximately 3.0 MB of relevant stored fields before the change.
- Test and build the 8,192-event cap while preserving all independent privacy and byte bounds.
- Prepare and review a fresh v18 manifest before any further provider call.

## References

- [Canary observation capacity](0299-stop-v16-and-expand-canary-observation-capacity.md)
- [Claim reference eligibility](0297-separate-claim-reference-eligibility-from-task-evidence.md)
- [Managed canary specification](../../../../../specifications/execution/managed-linked-evidence-canary.md)
