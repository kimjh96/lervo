# Lervo Agent Instructions

These instructions apply to every coding agent working in this repository.

## Read before changing

- Product scope or terminology: `README.md`, `docs/product/vision.md`
- Components or data flow: `docs/architecture/system.md`
- Execution, documentation guarantees, telemetry, or skills: `docs/specifications/execution.md`
- Delivery scope or order: `docs/roadmap/v0.md`
- Repository knowledge, migration, claims, relations, or OKF exchange: `docs/specs/repository-knowledge-compilation.md`

Read only the directly relevant ADRs linked by those entrypoints. Do not load the entire ADR history by default.

## Invariants

1. Local execution must complete without a Hub.
2. Keep provider-specific behavior behind adapters; core execution and evidence contracts must not depend on Codex or Claude.
3. Do not conflate `selected`, `loaded`, `injected`, and `used`, or claim understanding that telemetry cannot prove.
4. Markdown, repository state, skill definitions, verification results, and execution events are canonical. Graphs, search indexes, and embeddings are rebuildable projections.
5. Separate Lervo-managed blocks from user-owned blocks. Never overwrite user-owned content automatically.
6. Mark unobservable direct provider work as `unmanaged`.
7. Keep entrypoints short. Put each independent concern in a separate file with explicit links instead of appending history.
8. Generated documentation defaults to English through a versioned language boundary.
9. Do not create feature directories until an artifact must be written there.

## Change contract

- Update affected documentation and roadmap completion criteria when a design decision changes.
- For a new event or state, define its name, required fields, privacy handling, and failure meaning.
- Run common contract tests for provider adapters.
- Run relevant tests and the document lifecycle checks before finishing implementation.
- Use `lervo migrate knowledge` for repository-wide knowledge lifecycle changes and verify with `lervo knowledge lint`.

## Environment lookup

Before asking for mutable connection or device details, inspect `.lervo/environment-sources/` and `.lervo/environment-targets/`, then refresh observations with `lervo environment query --target <target-id> --json`.

Do not infer current validity from an old conversation or observation. Ask only when candidates conflict, validation fails, or required authority is missing. Keep secrets out of tracked manifests and `.lervo/state/` out of source documentation.
