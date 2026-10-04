# ADR-0440: Page complete execution evidence for canonicalization

Status: `accepted`
Decision date: 2026-09-28

## Context

The installed Lervo repository exceeded the complete execution adapter's 16 MiB corpus bound with 17,463 selected originals. [ADR-0437](../0437-stream-validated-recent-execution-evidence.md) restores interactive startup through a recent projection; [ADR-0439](../../../execution/orchestration/governed-work/node-composition/0439-project-complete-scoped-supervision-history.md) restores scoped supervisor history. Neither establishes complete knowledge compilation or authorizes forgetting historical evidence.

The scanner already accepts supplemental event sources alongside ordinary repository and verification sources. Each original has a stable `@event/<eventId>` path, canonical content, event locator, and `execution-event-v1+event-chain` adapter. Pagination preserves these identities.

## Decision

Add a separate complete paged adapter for CLI knowledge compilation, migration, and lifecycle checks. Preserve the legacy complete adapter's source bytes and 16 MiB corpus contract. Interactive context retains its independent recent-window contract.

Before traversal, pin the observed canonical head's sequence, project, and hash. Traverse its entire immutable prefix in storage pages of at most 1,000 rows. Validate consecutive sequences, one project, original hashes, schema-valid envelopes, unique event IDs across the complete prefix, and the exact final head anchor. Check store integrity before and after traversal. Valid concurrent appends may remain outside the pinned prefix. Missing rows, replacement, duplicate IDs, unavailable pages, or an invalid final integrity observation fail the entire collection.

Retain selected sources in at most four complete pages, each limited to 32,768 sources and 16 MiB. Each selected event retains its 256 KiB limit and exact privacy allowlist; no event may span pages. Preserve every selected original's path, locator, adapter, title, and content. The complete canonical prefix remains limited to 100,000 sequences. A fifth page requires an independently reviewed history design, not automatic growth.

The adapter also binds the tracked repository policy's source-count and aggregate-byte ceilings. Larger policy bounds cannot exceed the four-page contract. The unchanged scanner independently enforces that policy against ordinary files, verification results, and all flattened event pages together. Pages neither reserve capacity nor bypass per-file checks or make an old smaller policy current. A repository exceeding its combined policy fails closed pending a reviewed policy or corpus decision.

### Initial Lervo policy adjustment

For Lervo only, the initial measured tracked-policy adjustment changes `maxFiles` from 20,000 to 32,768. A read-only WSL observation through sequence 30,282 at 2026-09-27 21:13 UTC contains 18,084 exact execution originals, 50 verification results, and 23,313 sources overall. Its 23,296 included sources occupy 42,327,870 bytes. The old policy fails specifically on source count; the reviewed value provides approximately 40 percent count headroom.

The 1 MiB per-file and 64 MiB aggregate bounds, exclusions, product default of 20,000 files, and other repositories' tracked policies remain unchanged by this initial adjustment. Apply binds exact before/after policy bytes. Neither the observation nor the policy change proves full baseline currency.

### 2026-09-29 Lervo policy capacity review

A read-only installed WSL observation at sequence 58,893 verified the complete event chain and all 38,583 execution originals, totaling 38,707,277 canonical bytes. The tracked 32,768-source ceiling now rejects complete CLI knowledge migration before the repository scanner runs, although the chain and individual evidence are valid. The earlier adjustment covered its observed corpus, not this later population.

For Lervo only, raise tracked `maxFiles` from 32,768 to 131,072 and `maxTotalBytes` from 64 MiB to 128 MiB. Preserve the 1 MiB per-file limit, exclusions, complete event validation, 100,000-sequence anchor, four-page limit, 32,768-source and 16 MiB per-page limits, and scanner enforcement.

The source-count ceiling exceeds the maximum selected-event count under the four-page contract while allowing ordinary and verification sources. The aggregate ceiling accommodates four full 16 MiB event pages, a 16 MiB verification corpus, and up to 48 MiB of ordinary sources; the scanner still rejects a larger actual combined corpus. This adjustment neither discards older events nor establishes baseline currency. A fifth page, sequence 100,001, or a larger ordinary corpus requires a separate measured design or policy decision.

### Collection and compatibility boundaries

Return pages only after complete prefix verification succeeds. Expose no partial-result iterator or mutation callback. Because the scanner accepts a flat collection, CLI composition flattens only completed pages and preserves ordinary deterministic ordering. Compilation uses bounded full collection, not constant-memory streaming. Peak selected content is at most four 16 MiB pages plus bounded storage traversal and existing scanner structures.

This changes no canonical event, writer version, durable registry, provider allowance, source-kind, or asset authority. Original records remain untouched. Legacy managed-canary boundary pins remain unchanged and prove only their original population. New regressions and installed full-source observations provide separate evidence.

## Failure and privacy

Use `knowledge_evidence_source_invalid` for unverifiable or overflowing complete collections. Return no pages and expose no source bodies, paths, prompts, or native diagnostic. Invalid caller limits are configuration errors. Scanner aggregate failures retain `knowledge_source_limit_exceeded`.

Pagination success proves complete validated evidence collection through the pinned head, not semantic acceptance, current normalization, provider use, or baseline currency.

## Verification and delivery

Regressions cover complete originals across legacy byte and count boundaries, independent page bounds, the fifth-page stop, tracked count and byte limits, valid concurrent append, missing and duplicate rows, rehashed unsafe payloads, tampering, head mismatch, final integrity failure, sequence and per-event bounds, and the scanner's combined ordinary-plus-event aggregate.

Run common provider contracts, relevant CLI composition and lifecycle suites, structural review, quality, types, documentation, distribution checks, packed consumers, and the task-base release check. Migrate knowledge and lint. Install compatible CLI and Node consumers before production-fleet full-source lifecycle operations. Installed source coverage and debt currency remain distinct roadmap conditions.

## References

- [Original complete execution-source capacity](../0403-expand-execution-event-source-capacity.md)
- [Background convergence runtime](../../../../specs/background-knowledge-convergence/runtime.md)
- [Background convergence roadmap](../../../../roadmap/knowledge/autonomous-background-convergence.md)
