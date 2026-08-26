# Lervo Agent Instructions

## Before changing anything

Read only relevant entrypoints and linked ADRs:

- Product scope or terminology: `README.md`, `docs/product/vision.md`
- Components or data flow: `docs/architecture/system.md`
- Execution, documentation guarantees, telemetry, or skills: `docs/specifications/execution.md`
- Delivery scope or order: `docs/roadmap/v0.md`
- Repository knowledge, migration, claims, relations, or OKF exchange: `docs/specs/repository-knowledge-compilation.md`

Do not load the entire ADR history by default.

Before committing, follow [the repository commit convention](docs/foundation/commit-convention.md). An optional scope must exactly match the workspace package name without `@lervo/`; omit it for repository-wide changes.

Before opening or updating a pull request, read [the repository pull-request template](.github/PULL_REQUEST_TEMPLATE.md) and apply the existing [`writing_en-human` policy](packages/core/src/writing-contract.ts) to its title and body. Start the body at H2 because GitHub renders the title separately; never duplicate it with an H1. Preserve every section, replace guidance with exact evidence, and use `N/A: <reason>` for inapplicable sections. Evaluate each checklist item directly, checking it only after observing supporting evidence and recording blockers for unchecked items. Never submit prose-only summaries or pre-checked boilerplate.

Follow [the repository code convention](docs/foundation/code-convention.md) as the completion contract. Before editing source, identify its responsibility and dependency boundary. Apply module-split signals and the review checklist to every touched source file; resolve structural violations before finishing because lint and formatting are insufficient.

If a required split materially increases delivery risk, record one bounded follow-up with the exact responsibility and verification. Repeat the structural review before refreshing a long-module review hash; the registry records cohesive modules, not unresolved exceptions.

ESLint owns automatable code quality; Prettier owns formatting. For source or configuration changes, run `pnpm quality:check` and keep broad automatic-fix diffs within scope.

## Invariants

1. Local execution works without a Hub.
2. Provider behavior stays behind adapters; core execution and evidence contracts do not depend on Codex or Claude.
3. Keep `selected`, `loaded`, `injected`, and `used` distinct; claim only what telemetry proves.
4. Markdown, repository state, skill definitions, verification results, and execution events are canonical. Graphs, search indexes, and embeddings are rebuildable projections.
5. Keep Lervo-managed and user-owned blocks separate; never overwrite user-owned content automatically.
6. Mark unobservable direct provider work as `unmanaged`.
7. Keep entrypoints short and move independent concerns into linked files.
8. Generate English documentation through a versioned language boundary by default.
9. Create feature directories only with their first artifact.

## Change contract

- Update affected documentation and roadmap completion criteria when a design decision changes.
- For every new event or state, define its name, required fields, privacy handling, and failure meaning.
- Run common contract tests for provider adapters.
- Run relevant tests and document lifecycle checks before finishing implementation.
- For repository-wide knowledge lifecycle changes, run `lervo migrate knowledge`, then `lervo knowledge lint`.

## Environment lookup

Before requesting mutable connection or device details, inspect `.lervo/environment-sources/` and `.lervo/environment-targets/`, then refresh observations with `lervo environment query --target <target-id> --json`.

Do not infer current validity from old conversations or observations. Ask only when candidates conflict, validation fails, or authority is missing. Keep secrets out of tracked manifests and `.lervo/state/` out of source documentation.

## Fresh-clone continuation

If a fresh clone has no local or Hub-imported current workstream, recover the next bounded scope from `docs/roadmap/v0.md` and its linked active or planned roadmap. Do not ask the user for a bookkeeping command or assume no prior work. Create the recovered checkpoint before changing repository bytes.

<!-- lervo:begin block=repository_instruction_routes schema=1 -->
## Repository instruction routes

- Read the verified current state with `lervo workstream current --context` before continuing repository work.
- Before completing a terminal turn, create the first bounded checkpoint with `lervo workstream start` or advance the existing snapshot with `lervo workstream update`; perform this agent bookkeeping without asking the user to run it.
- Translate explicit natural-language requests to hire, assign, inspect, resolve, hand off, or retire repository agents into `lervo agent`, `lervo assignment`, and workstream operations yourself; when authority or scope is ambiguous, record one bounded pending decision instead of guessing or asking for a bookkeeping command.
- Resolve roles with `lervo role list|show|validate`; treat the six built-ins as templates, author a lazy `.lervo/roles/<role-id>.json` source when a requested repository role does not exist, and never bypass version, hash, capability, verification, or ancestry validation.
- Register every subagent with its parent and apply the same durable identity, scoped lease, path-conflict, evidence, verification, and finalization contracts used for root agents.
- For all repository work, read [evidence-bound-repository-changes](docs/instructions/evidence-bound-repository-changes.md).
<!-- lervo:end block=repository_instruction_routes -->

<!-- lervo:begin block=development_pattern_routes schema=1 -->
## Promoted development patterns

- [Evidence-bound repository changes](docs/instructions/evidence-bound-repository-changes.md)
<!-- lervo:end block=development_pattern_routes -->
