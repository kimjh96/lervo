# Lervo

Lervo is a local-first operating layer for durable, inspectable AI-assisted repository work. It gives Codex and Claude a provider-neutral execution contract, works without a Hub, and can optionally coordinate repositories, devices, and agents through one.

## What it provides

- Managed Codex and Claude runs with explicit lifecycle evidence.
- Bounded knowledge from repository documents, instructions, code, configuration, schemas, tests, verification, and other sources.
- Read-only plans, repository-scoped decisions, exact approvals, durable apply, rollback, lint, and query workflows.
- Generated knowledge maps, provider-neutral `AGENTS.md`, Claude's `@AGENTS.md` bridge, and optional authenticated Hub/node coordination.

Discovery, selection, loading, injection, reference, and use are distinct; Lervo claims only what telemetry proves.

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

Rerun `lervo migrate knowledge` after each staged apply until current. A reviewed stage adds Lervo-owned `UserPromptSubmit` and `Stop` handlers to Codex and Claude project configuration. Existing settings and hooks remain; disabled, malformed, or conflicting hooks block migration.

The global install uses the built checkout. To install an archive, run `pnpm --dir apps/cli pack --pack-destination <directory>`, then install its `.tgz` with `npm install --global <archive>`.

`init` creates minimum configuration. Migration routes sources and creates bounded navigation under `docs/knowledge/`. After structural work is current, `--provider` stores a no-tool rewrite candidate. Review every output and approve each content-bound item; apply never reruns the provider.

## Managed runs

```bash
lervo run --provider codex --path src/example.ts --verification project.quick \
  "Implement the next verified task"
lervo run --provider claude --path src/example.ts --verification project.quick \
  "Review and update the current implementation"
```

Each verification names a tracked suite under `.lervo/verifications/`. Success requires the declared file boundary, project suite, and result-publication checks. A separate read-only local provider session evaluates writing in an empty temporary repository.

Inspect runs with `lervo trace --full <run-id> --json`. Full traces reconstruct E1 selection grounds, E2 versions, E3 deliveries, validated E4 citations, separate delivery/reference/relevance coverage, and missing evidence. E4 metadata is removed from the separately hashed human result before writing evaluation and display; it never proves understanding or internal use.

After terminal-hook migration, the apply result reports one explicit Codex action: open the repository in Codex, run `/hooks`, and review and trust the two Lervo command hooks. Codex skips untrusted project hooks; Lervo never changes that security decision. Direct Codex and Claude terminals then invoke Lervo automatically. Prompts query and exact-hash load knowledge; Stop blocks stale migration, lint, normalization, or continuation checkpoints. `lervo terminal status --json` separates lifecycle, observed invocations, and activation readiness; it exits nonzero until every installed provider event has been observed and gives the exact remaining action. `lervo terminal coverage --json` reports preparation and exact final-output references; acceptance and internal use remain unsupported.

Direct sessions remain unmanaged. Use `lervo run` for managed capabilities, writes, delivery receipts, and verification evidence.

## Current workstream

Mutable continuation state stays out of root documentation. Migration searches safely included Markdown across the repository for content-shaped continuation candidates; names and locations are signals, not contracts. One unambiguous or explicitly selected source becomes a reviewed revisioned local workstream, while ambiguous sources remain untouched. Repositories without prior continuation documents start from the first agent checkpoint. Exact legacy bytes remain in CAS, and durable facts remain in canonical docs.

```bash
lervo workstream current --context
lervo workstream current --json
lervo workstream start --from first-workstream.json --json
lervo workstream start --from first-workstream.json --apply <plan-id>
lervo workstream update --from next-workstream.json --json
lervo workstream update --from next-workstream.json --apply <plan-id>
```

The start command is a recovery and inspection surface, not routine user bookkeeping. Direct Codex and Claude hooks tell the working agent to create or advance the checkpoint, and Stop fails closed until the revision advances. Managed runs load a present current workstream with E1–E3 evidence. Unmanaged hooks prepare verified bounded state without claiming acceptance or use.

## Repository knowledge

Start at [docs/knowledge/index.md](docs/knowledge/index.md). Generated indexes are navigation, not semantic truth. Markdown and repository state are canonical; graph, lexical, and embedding indexes are rebuildable.

```bash
node apps/cli/dist/bin.js knowledge compile --provider codex --json
node apps/cli/dist/bin.js knowledge compile --provider claude --json
```

Candidates remain unreviewed until reconciliation and explicit review. Migration changes user content only through exact approval and validates managed blocks, code/link coordinates, skill identity, and skill-resource bindings. Provider configuration, scripts, and assets are inventoried, not translated.

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

Lervo is pre-1.0. The v0 scope—local managed execution, repository knowledge, and optional Hub/node runtimes—is implemented, but interfaces may change before a stable release.
