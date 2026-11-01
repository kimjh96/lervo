# Source Discovery and Units

## Sources

The scanner walks repository files subject to VCS, dependency, generated, state, secret, size, and count exclusions. It excludes Python `.venv` and `venv` directories at every depth, like `node_modules`.

Generated tool-cache directories (`.cache`, `.mypy_cache`, `.pytest_cache`, `.ruff_cache`, `.tox`, `.nox`, and `__pycache__`) are excluded at every depth, even when an older tracked policy omits them. These rebuildable bytes are never canonical source or managed change evidence. The default policy records these patterns for new repositories.

Scans and internal knowledge registries ignore Finder `.DS_Store` files and regular AppleDouble `._*` sidecars as transport metadata. Directories and symbolic links with these names remain subject to normal fail-closed safety checks.

The scanner classifies documentation, instructions, code, configuration, schemas, tests, automation, skills, workflows, agents, policies, hooks, client and tool configuration, revision identity, verified artifacts, allowlisted events, sensitive logs and traces, and unsupported binaries.

Ordinary bytes may enter structural extraction. Sensitive log bytes never enter publication or external compilation. Secret candidates are excluded before reading. Discovery proves presence only, not loading, trust, injection, or use.

Each scan attempt compiles its current exclusion patterns once. All admitted files are still read afresh, and all source-unit extraction and snapshot identities retain their existing semantics. The matcher has no cross-scan lifetime; policy changes take effect on the next scan.

Read-only query preparation can explicitly supply an exact-content-bound extraction projection. Reuse applies only after current admission and safe reads, and binds project, policy, extractor build, and source identity. Only successful extraction is cached; a file-only parser fallback is always recomputed and still fails in strict mode. Cross-file skill contracts, sensitive sources, revision metadata, and event/verification sources retain fresh construction. Authoritative lifecycle scans use complete extraction by default; see [ADR-0499](../../../../decisions/knowledge/maintenance/0499-reuse-content-bound-knowledge-preparation-projections.md).

## Total-byte admission and coverage

[ADR-0537](../../../../decisions/knowledge/repository/source-intake/0537-degrade-over-budget-scans-by-priority.md) replaced aggregate-byte failure during discovery with priority admission. [ADR-0544](../../../../decisions/knowledge/repository/source-intake/0544-observe-every-source-and-budget-only-retained-content.md) separates observing a source from retaining it. The scanner reads every eligible text source once to validate it and compute its content hash, byte count, and line count. The unchanged `maxTotalBytes` policy budget bounds only the text kept in memory, spent in this retention order:

1. Agent instructions and recognized provider surfaces.
2. Portable `.agents/skills` manifests, instructions, and resources.
3. Canonical documentation trees and publication indexes from the document layout.
4. Research, evidence, archives, other documents, Markdown anywhere, and revision metadata.
5. Source code and configuration, including tests, schemas, and build definitions.
6. Lervo execution and verification evidence (`@event/`, `@verification/`), the class `execution_evidence`.

The agent artifact profiles, source classification, declared layout routes, document roles, and reserved documentation-tree catalog own these classes. Layout and priority share canonical-tree recognition. Declared publication indexes outrank research placement. An unavailable or invalid layout uses the default tree catalog for read-only admission; migration still validates the layout separately. Within a class, normalized repository-relative paths use code-point ordering, independent of host locale. A source that does not fit is still read; later smaller sources may still be retained. Output sources and units retain the existing scanner `localeCompare` order. The code-point comparator governs retention only. Virtual transforms use the same result and digest order as real scans.

A source that does not fit releases its text right after that read. It stays `status: included` with its `contentHash` and gains `contentRetention: observed_only`. It carries no content. It keeps exactly one whole-source unit: the `file:/` unit, or the revision or supplemental evidence unit, with the identity, version, hash, and range of a retained read. It has no section, symbol, key, or skill-contract units. A skill package with an observed-only file does not receive a validated cross-file skill-contract unit. Supplemental evidence content is never written to scan results.

Every scan reports `coverage: complete | partial`, `skippedForBudget: { count, bytes, classes }`, and `retention: { observedOnly: { count, bytes, classes } }`. Both summaries count every source that was not retained; classes are distinct and in retention order. Coverage is complete when every eligible source has a content hash and every source in classes 1–4 is retained. Observed-only code and evidence are a Find gap, not partial coverage. `inventoryCoverage.includedBytes` counts every included source, retained or not, and its `complete` flag matches the scan coverage. Extension-certain ordinary binaries are unsupported before admission and are never read. Opaque skill resources consume the retention budget although they keep no text. Per-file limits, binary, secret-candidate, and environment-file rules, supplemental adapter limits, and the hard `maxFiles` stop retain their behavior; a source they reject is unsupported and unhashed.

Structural publication counts, groups, and concept unit lists treat observed-only sources exactly as retained ones. The publication snapshot binds source metadata without the retention marker and whole-file unit versions only, so publications do not depend on the budget when documents fit. Readers of document text see classes 1–4, which a complete scan always retains. A layout migration rereads an observed-only file to rewrite references to moved documents, and application-content evidence rereads observed-only code; both require the bytes to match the observed hash and fail with `source_bytes_changed` otherwise.

Scan snapshot identifiers stay hash-based over source metadata, which includes the retention marker, and unit versions, so observed-only and fully retained scans differ. The source-unit projection maps exact retained bytes to their complete extraction; observed-only sources never read or write it. The document-staleness projection binds a retention digest over observed-only paths. Impact evaluation cannot attribute an absent cited unit to a source, because unit identifiers are one-way digests. While any source is observed only, an absent cited unit is `unknown` with `scan_incomplete`; a present whole-file unit of an observed-only source is current or changed by its hash.

Query, prompt context, review context, impact reporting, and lint reporting accept partial coverage. Query output includes coverage, compact skipped-class counts, and the observed-only Find gap, even when there are no hits. Publications whose source text was not retained are not reread through the query publication loader. Convergence discovery, canonicalization/compilation, lifecycle verification, migration completeness, and materialization require complete scans, including caller-prepared and virtual scans. They stop with `knowledge_source_limit_exceeded` before claiming currency or recording a current baseline; the code now means the knowledge classes exceed the budget or a file rule stopped intake. Lint carries coverage independently of reporting validity; baseline admission and verification receipts require complete coverage. Reduced content digests cannot prove complete coverage, including when only metadata was not retained.

Currency adapters retain one replaceable, owner-only private diagnostic with the skipped count, byte count, and classes. It contains no source paths or content, adds no event type, and is not canonical evidence of currency. A persistence failure preserves the same stop code and remains attached to the private error. Stateless compilers reject partial input before provider calls and attach the skipped summary to their error; repository-aware callers own persistence.

## Source units

Sources have stable IDs and content-bound versions. Adapters may emit bounded Markdown sections; structured-data keys; code declarations and members; CSS rules, named at-rules, and custom properties; Git `HEAD`; verification; privacy-valid events; and validated skill contracts.

Parser failure rejects fine-grained extraction; otherwise, the file is the baseline unit.
