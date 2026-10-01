# Sources and Source Units

## Sources

The scanner walks repository files subject to VCS, dependency, generated, state, secret, size, and count exclusions. It excludes Python `.venv` and `venv` directories at every depth, like `node_modules`.

Generated tool-cache directories (`.cache`, `.mypy_cache`, `.pytest_cache`, `.ruff_cache`, `.tox`, `.nox`, and `__pycache__`) are excluded at every depth even if an older tracked policy omits them. These rebuildable bytes are never canonical source or managed change evidence. The default policy records these patterns for new repositories.

Scans and internal knowledge registries ignore Finder `.DS_Store` files and regular AppleDouble `._*` sidecars as transport metadata. Directories and symbolic links with these names remain subject to normal fail-closed safety checks.

The scanner classifies documentation, instructions, code, configuration, schemas, tests, automation, skills, workflows, agents, policies, hooks, client and tool configuration, revision identity, verified artifacts, allowlisted events, sensitive logs and traces, and unsupported binaries.

Ordinary bytes may enter structural extraction. Sensitive log bytes never enter publication or external compilation. Secret candidates are excluded before reading. Discovery proves presence only, not loading, trust, injection, or use.

## Source units

Sources have stable IDs and content-bound versions. Adapters may emit bounded Markdown sections; structured-data keys; code declarations and members; CSS rules, named at-rules, and custom properties; Git `HEAD`; verification; privacy-valid events; and validated skill contracts.

Parser failure rejects fine-grained extraction; otherwise, the file is the baseline unit.

## Verification result sources and historical validation

The `verification-result-v1+event-cas` adapter accepts only integrity-checked `verification.completed` events with matching result CAS bytes, canonical serialization, verification ID, suite ID and recorded suite hash, repository revision, status, completion time, and nonpassing command IDs. It bounds the event prefix and result count, individual result size, and aggregate result size before publishing an ordinary `@verification/<id>` source. Any invalid binding rejects the whole supplemental corpus.

When the current suite definition still has the result's recorded suite hash, validation also checks the exact suite commands, their order and digests. When that suite definition has since changed, historical validation retains the result under its recorded suite hash and checks only suite-independent evidence: result schema, command outcome and artifact coordinates, execution times, overall status, and the content-derived verification ID. A later suite change does not retroactively invalidate a previously recorded result, and historical validation does not claim that the old commands satisfy the new suite or that the result proves a source claim true.
