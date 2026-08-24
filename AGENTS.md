# Lervo Agent Instructions

These instructions apply to every coding agent in this repository.

## Before changing anything

Read only the relevant entrypoints and linked ADRs:

- Product scope or terminology: `README.md`, `docs/product/vision.md`
- Components or data flow: `docs/architecture/system.md`
- Execution, documentation guarantees, telemetry, or skills: `docs/specifications/execution.md`
- Delivery scope or order: `docs/roadmap/v0.md`
- Repository knowledge, migration, claims, relations, or OKF exchange: `docs/specs/repository-knowledge-compilation.md`

Do not load the entire ADR history by default.

## Invariants

1. Local execution must work without a Hub.
2. Keep provider behavior behind adapters. Core execution and evidence contracts must not depend on Codex or Claude.
3. Keep `selected`, `loaded`, `injected`, and `used` distinct. Claim only what telemetry proves.
4. Treat Markdown, repository state, skill definitions, verification results, and execution events as canonical. Graphs, search indexes, and embeddings are rebuildable projections.
5. Keep Lervo-managed and user-owned blocks separate. Never overwrite user-owned content automatically.
6. Mark unobservable direct provider work as `unmanaged`.
7. Keep entrypoints short. Move independent concerns into separately linked files instead of appending history.
8. Generate English documentation through a versioned language boundary by default.
9. Create feature directories only when writing their first artifact.

## Change contract

- Update affected documentation and roadmap completion criteria when a design decision changes.
- For every new event or state, define its name, required fields, privacy handling, and failure meaning.
- Run common contract tests for provider adapters.
- Run relevant tests and document lifecycle checks before finishing implementation.
- For repository-wide knowledge lifecycle changes, run `lervo migrate knowledge`, then verify with `lervo knowledge lint`.

## Environment lookup

Before requesting mutable connection or device details, inspect `.lervo/environment-sources/` and `.lervo/environment-targets/`, then refresh observations with `lervo environment query --target <target-id> --json`.

Do not infer current validity from an old conversation or observation. Ask only if candidates conflict, validation fails, or required authority is missing. Keep secrets out of tracked manifests and `.lervo/state/` out of source documentation.

## Fresh-clone continuation

If a fresh clone has no local or Hub-imported current workstream, recover the next bounded scope from `docs/roadmap/v0.md` and its linked active or planned roadmap. Do not ask the user for a bookkeeping command or assume there is no prior work. Create the recovered first checkpoint before changing repository bytes.

<!-- lervo:begin block=repository_instruction_routes schema=1 -->
## Repository instruction routes

- Read the verified current state with `lervo workstream current --context` before continuing repository work.
- Before completing a terminal turn, create the first bounded checkpoint with `lervo workstream start` or advance the existing snapshot with `lervo workstream update`; perform this agent bookkeeping without asking the user to run it.
<!-- lervo:end block=repository_instruction_routes -->
