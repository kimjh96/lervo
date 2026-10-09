# Source Discovery and Units

## Sources

The scanner walks repository files subject to VCS, dependency, generated, state, secret, size, and count exclusions. It excludes Python `.venv` and `venv` directories at every depth, like `node_modules`.

Generated tool-cache directories (`.cache`, `.mypy_cache`, `.pytest_cache`, `.ruff_cache`, `.tox`, `.nox`, and `__pycache__`) are excluded at every depth, even when an older tracked policy omits them. These rebuildable bytes are never canonical source or managed change evidence. The default policy records these patterns for new repositories.

Scans and internal knowledge registries ignore Finder `.DS_Store` files and regular AppleDouble `._*` sidecars as transport metadata. Directories and symbolic links with these names remain subject to normal fail-closed safety checks.

The scanner classifies documentation, instructions, code, configuration, schemas, tests, automation, skills, workflows, agents, policies, hooks, client and tool configuration, revision identity, verified artifacts, allowlisted events, sensitive logs and traces, and unsupported binaries.

Ordinary bytes may enter structural extraction. Sensitive log bytes never enter publication or external compilation. Secret candidates are excluded before reading. Discovery proves presence only, not loading, trust, injection, or use.

Each scan attempt compiles its current exclusion patterns once. All admitted files are still read afresh, and all source-unit extraction and snapshot identities retain their existing semantics. The matcher has no cross-scan lifetime; policy changes take effect on the next scan.

Read-only query preparation can explicitly supply an exact-content-bound extraction projection. Reuse applies only after current admission and safe reads, and binds project, policy, extractor build, and source identity. Only successful extraction is cached; a file-only parser fallback is always recomputed and still fails in strict mode. Cross-file skill contracts, sensitive sources, revision metadata, and event/verification sources retain fresh construction. Authoritative lifecycle scans use complete extraction by default; see [ADR-0499](../../../../decisions/knowledge/maintenance/0499-reuse-content-bound-knowledge-preparation-projections.md).

## Source units

Sources have stable IDs and content-bound versions. Adapters may emit bounded Markdown sections; structured-data keys; code declarations and members; CSS rules, named at-rules, and custom properties; Git `HEAD`; verification; privacy-valid events; and validated skill contracts.

Parser failure rejects fine-grained extraction; otherwise, the file is the baseline unit.
