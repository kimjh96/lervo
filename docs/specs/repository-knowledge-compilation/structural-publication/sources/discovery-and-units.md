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

[ADR-0537](../../../../decisions/knowledge/repository/source-intake/0537-degrade-over-budget-scans-by-priority.md) replaces aggregate-byte failure during discovery with priority admission. The scanner lists candidates and sizes before reading content, then spends the unchanged `maxTotalBytes` policy budget in this order:

1. Agent instructions and recognized provider surfaces.
2. Portable `.agents/skills` manifests, instructions, and resources.
3. Canonical documentation trees and publication indexes from the document layout.
4. Source code and configuration, including tests, schemas, and build definitions.
5. Research, evidence, archives, other documents, revision metadata, and supplemental evidence.

The agent artifact profiles, source classification, declared layout routes, document roles, and reserved documentation-tree catalog own these classes. Layout and priority share canonical-tree recognition. Declared publication indexes outrank research placement. An unavailable or invalid layout uses the default tree catalog for read-only admission; migration still validates the layout separately. Within a class, normalized repository-relative paths use code-point ordering, independent of host locale. A candidate that does not fit is skipped; later smaller candidates may still fit. Output sources and units retain the existing scanner `localeCompare` order, preserving installed snapshot identifiers. The code-point comparator governs budget admission only. Virtual transforms use the same result and digest order as real scans.

A skipped candidate retains its stable source identity, path, kind, origin if any, and byte count, with `status: unsupported`, `classification: unsupported`, `contentHash: null`, and `reason: total_budget_exceeded`. It carries no content and produces no source units. A skill package with a budget-skipped resource does not receive a validated cross-file skill-contract unit; skipped resources are never reread to validate that contract.

Every scan reports `coverage: complete | partial` and `skippedForBudget: { count, bytes, classes }`. Classes are distinct and ordered by admission priority. Zero budget skips means complete coverage under the existing policy; it does not mean that excluded, binary, or individually oversized files were read. Existing numeric aggregates move to `inventoryCoverage`, whose `complete` flag matches the scan coverage. Extension-certain ordinary binaries are unsupported before admission and do not consume budget. Opaque skill resources still consume budget. Per-file limits, supplemental adapter limits, and the hard `maxFiles` stop retain their behavior.

Query, prompt context, review context, impact reporting, and lint reporting accept partial coverage. Query output includes coverage and compact skipped-class counts, even when there are no hits. Skipped publications are not reread through the query publication loader. Convergence discovery, canonicalization/compilation, lifecycle verification, migration completeness, and materialization require complete scans, including caller-prepared and virtual scans. They stop with `knowledge_source_limit_exceeded` before claiming currency or recording a current baseline. Lint carries coverage independently of reporting validity; baseline admission and verification receipts require complete coverage. Reduced content digests cannot prove complete coverage, including when only metadata was skipped.

Currency adapters retain one replaceable, owner-only private diagnostic with the skipped count, byte count, and classes. It contains no source paths or content, adds no event type, and is not canonical evidence of currency. A persistence failure preserves the same stop code and remains attached to the private error. Stateless compilers reject partial input before provider calls and attach the skipped summary to their error; repository-aware callers own persistence.

## Source units

Sources have stable IDs and content-bound versions. Adapters may emit bounded Markdown sections; structured-data keys; code declarations and members; CSS rules, named at-rules, and custom properties; Git `HEAD`; verification; privacy-valid events; and validated skill contracts.

Parser failure rejects fine-grained extraction; otherwise, the file is the baseline unit.
