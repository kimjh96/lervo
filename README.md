# Lervo

Lervo is a local-first operating layer for AI-assisted repository work. It gives Codex and Claude a shared, provider-neutral execution contract while keeping repository evidence, decisions, and reusable knowledge inspectable.

Lervo works without a Hub. A Hub is optional coordination layer for multiple repositories, devices, and agents.

## What Lervo provides

- Managed Codex and Claude runs with explicit evidence and lifecycle events.
- Repository knowledge compiled from code, configuration, schemas, tests, documents, agent instructions, verification results, and other bounded sources.
- Read-only migration plans, repository-scoped decision taxonomy, exact approvals, durable apply, rollback, lint, and query workflows.
- A short, generated knowledge map whose pages are bounded instead of continuously appended.
- Provider-neutral `AGENTS.md` instructions and profiled provider bridges such as Claude's `@AGENTS.md` import.
- Optional Hub and node runtimes for authenticated remote coordination.

Lervo does not treat selection, loading, injection, and use as interchangeable claims. It records only what the available telemetry can prove.

## Quick start

Requirements: Node.js 22.13 or later and pnpm 11.

```bash
pnpm install
pnpm build
npm install --global ./apps/cli
lervo init
lervo migrate knowledge --json
```

Review the returned plan, then apply the exact current plan ID:

```bash
lervo migrate knowledge --apply <plan-id> --json
lervo knowledge lint --json
lervo knowledge query "managed provider" --json
```

The global install above uses the built local checkout; npm registry publication is not required. For an independent archive, run `pnpm --dir apps/cli pack --pack-destination <directory>` and install the resulting `.tgz` with `npm install --global <archive>`.

`init` creates only the minimum Lervo configuration. It does not create empty feature directories or invent repository documentation. `migrate knowledge` creates missing human and agent entrypoints, preserves existing user-owned bytes, and materializes bounded navigation under `docs/knowledge/`.

## Managed provider runs

Use an installed provider through the common run contract:

```bash
lervo run --provider codex --path src/example.ts --verification project.quick \
  "Implement the next verified task"
lervo run --provider claude --path src/example.ts --verification project.quick \
  "Review and update the current implementation"
```

Each `--verification` value names a tracked suite under `.lervo/verifications/`. A successful command requires the declared file boundary, the project suite, and the result-publication checks to pass. The writing check uses a separate read-only local provider session in an empty temporary repository.

Direct provider sessions that Lervo cannot observe remain `unmanaged`; they are never presented as fully tracked runs.

## Repository knowledge

The main entrypoint is [docs/knowledge/index.md](docs/knowledge/index.md). Generated indexes are navigation aids, not semantic truth. Markdown and repository state remain canonical; graphs, lexical indexes, and embeddings are rebuildable projections.

For semantic compilation with an installed provider:

```bash
node apps/cli/dist/bin.js knowledge compile --provider codex --json
node apps/cli/dist/bin.js knowledge compile --provider claude --json
```

Candidates are unreviewed until they pass reconciliation and explicit review. Migration may relocate documents, normalize agent surfaces, or update exact references only through content-bound item approvals; unmanaged user regions remain byte-preserved. Provider configuration is inventoried, not translated.

## Documentation

- [Product vision](docs/product/vision.md)
- [System architecture](docs/architecture/system.md)
- [Execution and evidence specification](docs/specifications/execution.md)
- [v0 roadmap](docs/roadmap/v0.md)
- [Repository knowledge compilation specification](docs/specs/repository-knowledge-compilation.md)
- [Architecture decisions](docs/decisions/)
- [Research](docs/research/)

Keep this README short and task-oriented. Detailed contracts, decisions, and historical rationale belong in their own linked documents.

## Development

```bash
pnpm typecheck
pnpm test
pnpm docs:check
pnpm build
```

Run `pnpm check` for the full release-oriented verification suite.

## Status

Lervo is pre-1.0 software. The agreed v0 scope is complete: local managed execution, repository knowledge workflows, and optional Hub/node runtimes are implemented. Interfaces may still change before a stable release.
