# ADR-0544: Observe every source and budget only retained content

Status: `accepted`
Decision date: 2026-11-01
Amends: [ADR-0537](0537-degrade-over-budget-scans-by-priority.md) (budget admission, coverage, priority classes)

## Context

[ADR-0537](0537-degrade-over-budget-scans-by-priority.md) keeps queries working when a repository exceeds `maxTotalBytes`. A source that does not fit is recorded as `unsupported` with no content hash, and every path that claims currency stops with `knowledge_source_limit_exceeded`.

On 2026-11-01, `lervo upgrade` in `axli` stopped at the knowledge stage for that reason. `axli` keeps its 32 MiB policy budget. The scan admitted 3,855 sources:

- 15.0 MiB of Python sources and tests, 4.7 MiB of TypeScript, and 2.0 MiB of JSON schemas and snapshots;
- 8.2 MiB of Markdown;
- about 1.7 MB of Lervo's own execution and verification evidence, supplied as `@event/` and `@verification/` sources.

Code and evidence took the budget first, and 71 research documents (1.1 MB) were skipped. Raising the budget would only defer the next stop: code, tests, and Lervo's own evidence keep growing, while the documents that knowledge currency depends on did not change.

The budget exists to bound memory and time on every host. Two things were coupled that do not need to be:

- **Observing a source** means knowing its path, size, and content hash, and whether it changed. Hashing a file is a bounded, transient read.
- **Retaining a source** means keeping its text in memory and extracting its section, symbol, and key units. Retention is what grows with the repository.

Because over-budget sources lost their hash, the scanner could not even tell whether they changed. Every currency claim then failed, including claims about documents that were fully read.

## Decision

### Every eligible source is observed

The scanner reads every eligible text source once, as today, to validate it and compute its content hash, byte count, and line count. A source that does not fit the retained-content budget releases its text immediately after that read. It stays `status: "included"` with its `contentHash` and gains `contentRetention: "observed_only"`. Its `content` is absent. It keeps one whole-file unit (`file:/`), whose identity, version, hash, and range equal those of a fully retained read. It has no section, symbol, key, or skill-descriptor units.

`maxFiles`, `maxFileBytes`, binary, secret-candidate, and environment-file rules are unchanged. A source rejected by those rules is still unsupported and unhashed.

### The budget bounds retained content, in knowledge order

`maxTotalBytes` bounds the bytes of retained content. Retention follows this order, with code-point path order inside each class:

1. Agent instructions and provider surfaces.
2. Portable skills.
3. Canonical documents and publication indexes.
4. Other documents, including research and evidence documents in the repository.
5. Source code and configuration.
6. Lervo execution and verification evidence (`@event/`, `@verification/`), as the new class `execution_evidence`.

Documents now precede code. Lervo's own evidence is always last, so its growth can never displace repository knowledge.

### Coverage separates knowledge currency from search depth

- `coverage: "complete"` means every eligible source has a content hash and every source in classes 1–4 is retained. Currency-claiming paths keep requiring it.
- `coverage: "partial"` now means a knowledge-class source (classes 1–4) could not be retained. The documents themselves exceed the budget. This is a genuine stop: the owner consolidates documents or changes the budget. Lervo never changes it automatically.
- `skippedForBudget` keeps its shape and counts sources of every class that were not retained. A new `retention: { observedOnly: { count, bytes, classes } }` reports code and evidence that are observed but not retained. Query and the core health projection report it as a Find gap with the actor `repository scanner`: those files are known and change-tracked, but not searched by symbol or section.

### Currency consumers treat observed-only units as unknown

- Impact and staleness evaluation: a cited unit that is absent because its source is observed-only is `unknown` with reason `scan_incomplete`, never `stale` or `source_unit_missing`. A whole-file unit of an observed-only source is current or changed by its hash, as before.
- Structural publication counts, groups, and concept unit lists use observed-only sources exactly as retained ones. Publications are therefore independent of the budget.
- Consumers that need document text (normalization, layout, drift, instruction bridges, canonicalization) only see classes 1–4, which a complete scan always retains.
- Snapshot and cache identity: content snapshot identifiers stay hash-based. Any cache or projection whose value depends on extracted units, including the source-unit cache and staleness projections, additionally binds a retention digest over the observed-only paths. A scan with observed-only sources never satisfies, or is satisfied by, a fully retained entry.

## Events, states, privacy, and failure meaning

- No event type changes. Scan results gain the per-source `contentRetention` field and the `retention` summary. Observed-only sources keep path, size, and hash, and never content. Supplemental evidence content is never written to scan results.
- `knowledge_source_limit_exceeded` keeps its name. It now means the knowledge classes exceed the budget, or a file rule stopped intake, never that code or evidence grew.
- A read failure of an observed-only source fails the scan as it does for a retained source.

## Verification

Focused tests must show:

- When code and evidence exceed the budget but documents fit, the scan is `complete`. Every source has a hash. Observed-only sources have exactly one whole-file unit identical to a retained read.
- Documents are retained before code, and evidence after code, deterministically.
- When documents alone exceed the budget, the scan is `partial`, and currency paths stop with `knowledge_source_limit_exceeded`.
- An edit to an observed-only file changes its hash and whole-file unit version and is detected by impact. A claim citing an inner unit of an observed-only file is `unknown`, not `stale`.
- Structural publications are byte-identical with a large and a small budget when documents fit both.
- Unit-dependent caches never cross between observed-only and fully retained scans.
- Query reports the observed-only Find gap, and the existing per-file and `maxFiles` behavior is unchanged.

Installed verification must show `lervo upgrade` reaching `current` in `axli` with its 32 MiB budget unchanged.
