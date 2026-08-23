# Lervo

Lervo is a local-first operating layer for AI-assisted repository work. It gives Codex and Claude a shared, provider-neutral execution contract while keeping evidence, decisions, and reusable knowledge inspectable. It works without a Hub; the Hub is optional coordination for multiple repositories, devices, and agents.

## What Lervo provides

- Managed Codex and Claude runs with explicit evidence and lifecycle events.
- Bounded repository knowledge compiled from documents, instructions, code, configuration, schemas, tests, verification, and other sources.
- Read-only plans, repository-scoped decision taxonomy, exact approvals, durable apply, rollback, lint, and query workflows.
- Bounded generated knowledge maps, provider-neutral `AGENTS.md` guidance, and provider bridges such as Claude's `@AGENTS.md` import.
- Optional authenticated Hub and node coordination.

Lervo distinguishes discovery, selection, loading, injection, reference, and use, and claims only what available telemetry proves.

## Quick start

Requires Node.js 22.13 or later and pnpm 11.

```bash
pnpm install
pnpm build
npm install --global ./apps/cli
lervo init
lervo migrate knowledge --json
```

Review the plan, then apply its exact current ID:

```bash
lervo migrate knowledge --apply <plan-id> --json
lervo migrate knowledge --provider codex --json
lervo migrate knowledge --candidate <candidate-id> --apply <plan-id> \
  --approve-item <operation-id>=<approval-hash> --json
lervo knowledge lint --json
lervo knowledge query "managed provider" --json
```

The global install uses the built checkout; registry publication is unnecessary. To create an independent archive, run `pnpm --dir apps/cli pack --pack-destination <directory>` and install its `.tgz` with `npm install --global <archive>`.

`init` creates minimum configuration only. `migrate knowledge` first routes sources and creates bounded navigation under `docs/knowledge/`. Once structural work is current, `--provider` stores a no-tool rewrite candidate. Review its outputs and approve every content-bound item; apply does not rerun the provider.

## Managed provider runs

```bash
lervo run --provider codex --path src/example.ts --verification project.quick \
  "Implement the next verified task"
lervo run --provider claude --path src/example.ts --verification project.quick \
  "Review and update the current implementation"
```

Each `--verification` names a tracked suite under `.lervo/verifications/`. Success requires the declared file boundary, project suite, and result-publication checks. A separate read-only local provider session evaluates writing in an empty temporary repository. Unobserved direct provider sessions remain `unmanaged`.

## Repository knowledge

Start at [docs/knowledge/index.md](docs/knowledge/index.md). Generated indexes are navigation, not semantic truth. Markdown and repository state are canonical; graphs, lexical indexes, and embeddings are rebuildable.

Compile semantic candidates with an installed provider:

```bash
node apps/cli/dist/bin.js knowledge compile --provider codex --json
node apps/cli/dist/bin.js knowledge compile --provider claude --json
```

Candidates remain unreviewed until reconciliation and explicit review. Migration changes user content only through exact approvals. It validates managed blocks, code and link coordinates, skill identity, and skill-resource bindings. Provider configuration, scripts, and assets are inventoried rather than translated.

## Documentation

Agent guidance: [AGENTS.md](AGENTS.md).

- [Product vision](docs/product/vision.md)
- [System architecture](docs/architecture/system.md)
- [Execution and evidence specification](docs/specifications/execution.md)
- [v0 roadmap](docs/roadmap/v0.md)
- [Repository knowledge compilation specification](docs/specs/repository-knowledge-compilation.md)
- [Architecture decisions](docs/decisions/)
- [Research](docs/research/)

## Development

```bash
pnpm typecheck
pnpm test
pnpm docs:check
pnpm build
```

Run `pnpm check` for the full release-oriented suite.

## Status

Lervo is pre-1.0. The agreed v0 scope—local managed execution, repository knowledge workflows, and optional Hub/node runtimes—is implemented, but interfaces may change before a stable release.
