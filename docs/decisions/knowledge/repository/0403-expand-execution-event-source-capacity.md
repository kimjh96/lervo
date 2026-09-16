# ADR-0403: Expand the execution-event source capacity to 32,768 events

Status: `accepted`
Date: 2026-09-15

## Context

The installed WSL Lervo repository accumulated 8,220 execution-type events, about 3.2 MB of relevant stored fields, over its supervision journeys. During the fifteenth installed research goal, it crossed the 8,192-event cap set by [ADR-0300](../../search/activation/provider-shadow-structured/typed-context/0300-stop-v17-and-expand-complete-event-capacity.md). The complete execution-event knowledge source then failed closed with `knowledge_evidence_source_invalid` on every owner cycle. The scoped Node could not start because configuration open verifies the same source. Health showed only `supervision_cycle_failed`, and the journal gave no reason; revision `fd6cf5e5` adds the bounded failure line that surfaced the cause.

## Decision

Raise the complete execution-event source count cap from 8,192 to 32,768. Preserve the 100,000 sequence cap, 256 KiB per-event cap, 16 MiB total-byte cap, full chain verification, schema and hash validation, payload privacy allowlist, unique event IDs, and fail-closed behavior. Do not delete, truncate, skip, or overwrite historical events.

Treat the count cap as a secondary guard under the byte cap. At the observed average of about 380 bytes per relevant event, 32,768 events occupy about 12 MB, within the 16 MiB bound. A repository approaching either bound needs a reviewed compaction or snapshot design before further admission; that design requires a separate decision.

## Consequences

Installed supervision on a long-lived repository continues past 8,192 execution events without dropping evidence. Every reader built before this revision—CLI worker bundle, Node bundle, and Hub—rejects the repository once it crosses 8,192 events. All bundles that open the knowledge source must therefore be deployed from one revision at or after this one. The bound still fails closed, keeping growth observable.

The managed linked-evidence canary v18 checkpoint pins the exact bytes of `packages/repository-knowledge/src/execution-event-source.ts` as a reviewed execution-boundary source. Raising the cap invalidated its digest. The checkpoint was re-reviewed without weakening its certified closed complete-source verification or its run, failure, privacy, recall, and precision acceptance limits. This decision deliberately raises the capacity considered safe while preserving closed verification. The pinned source digest and the checkpoint's own reviewed digest were refreshed to the current bytes, and the checkpoint contract test passes against them. No acceptance limit, retention bound, or provider arm changed.

## Verification

- The execution-event source test asserts the 32,768-event cap while byte, sequence, and per-event bounds remain unchanged.
- The WSL scoped Node built from this revision opens the 8,220-event repository, resumes owner cycles, and completes the interrupted goal.

## References

- [Execution-event capacity expansion to 8,192](../../search/activation/provider-shadow-structured/typed-context/0300-stop-v17-and-expand-complete-event-capacity.md)
- [Discord successor preparation evidence](../../../evidence/foundation/outcome-supervision-local-and-wsl/deployment-and-upgrades/discord-successor-preparation.md)
