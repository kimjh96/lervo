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
```

For an existing repository, install the intended CLI release, run `lervo upgrade`, then apply its exact plan. It converges repository-owned stages and stops at user or provider authority; see the [upgrade roadmap](docs/roadmap/onboarding/repository-upgrade.md).

Production `lervo init` continues generated-only knowledge, instruction, hook-runtime, and initial-agent stages automatically. It stops only when existing user bytes, provider configuration, native hook trust, or external credentials require their own authority and prints that bounded pending action. Commands remain available:

```bash
lervo migrate knowledge --apply <plan-id> --json
lervo migrate knowledge --provider codex --json
lervo migrate knowledge --candidate <candidate-id> --apply <plan-id> \
  --approve-item <operation-id>=<approval-hash> --json
lervo knowledge lint --json
lervo knowledge query "managed provider" --json
```

Rerun `lervo migrate knowledge` after each staged apply until current. A reviewed stage adds Lervo-owned `UserPromptSubmit` and `Stop` handlers to Codex and Claude project configuration. The handlers use a repository-local, integrity-checked runtime generated from the installed CLI, so provider shells do not need a global `lervo` on `PATH` and repository subdirectories work. Existing settings and hooks remain; disabled, malformed, or conflicting hooks block migration. Later generated-runtime upgrades reconcile without approval unless provider configuration must also change.

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

## Agent workforce

Developer, researcher, marketer, designer, writer, and ideation are versioned built-in templates. A repository may add validated custom roles under `.lervo/roles/`, specialize or compose existing roles, and use them through the same managed run boundary. Repository agents and subagents share one durable lifecycle; assignments on disjoint paths can run concurrently, while overlapping scopes are rejected before provider execution. Leases, dependencies, exact role-contract hashes, verification suites, and artifact-hash handoffs make work resumable without assuming shared conversation memory.

Ask the working agent in ordinary Korean or English to hire, assign, inspect, hand off, resolve, suspend, or retire. Repository instructions direct it to perform unambiguous workforce bookkeeping itself. `lervo workforce plan --request <text>` is the privacy-bounded inspection surface and persists only a request digest when an operation later records evidence.

Inspect built-in and repository roles with `lervo role list`; use `lervo role show --role <role-id>` or `lervo role validate` to verify exact versions and hashes. The custom-role directory is created only with its first role source.

## Capability packages

Lervo manages versioned project or user capability packages for skills, MCP servers, provider plugins, and exact bundles. Local use does not require a Hub. Validation and installation are plan-first; resolution writes an exact lock and does not claim activation or use.

Verified discovery metadata lets a managed agent recommend and select a relevant package from the natural-language task when no explicit or role-default package was chosen. Evidence keeps recommendation, selection, verified loading, provider activation, skill invocation, and completion separate. A skill's exact rehashed `SKILL.md` is included in the managed turn; Lervo still makes no claim about model attention or semantic reliance.

```bash
lervo capability validate --from ./my-capability
lervo capability install --from ./my-capability --scope project
lervo capability install --from ./my-capability --scope project \
  --apply --approval <plan-hash>
lervo capability list --scope all
lervo capability resolve --capability research/web-search --provider codex
lervo migrate capabilities
lervo migrate capabilities --apply --approval <plan-id>
```

Roles may set `defaultCapabilityPackages`, and `lervo agent hire --capability <id>` binds exact versions and hashes. Subagents inherit their parent's set and cannot expand it. Managed runs accept `--capability <id>` and reject workforce capability drift before provider creation. Skill entrypoints continue through the existing skill contract. Codex and Claude managed runs configure selected MCP servers and native plugins locally, require provider-confirmed connection or load before the task turn, and report activation separately from invocation or use.

Hub sharing is optional, never automatic, and excludes secret material. `publish` and `pull` support authorized project scope or explicitly public scope, require a content-bound plan plus `--apply --approval`, and read the bearer only from `LERVO_HUB_TOKEN` or `--token-env <NAME>`.

Hub capability records are structured by content class, package kind, manifest version, file count, total bytes, and secret exclusion. Document sharing uses shared-context metadata plus CAS bytes, while repository knowledge uses OKF bundles; these are not opaque interchangeable uploads.

```bash
lervo capability publish --from ./my-capability --hub https://hub.example \
  --share public
lervo capability pull --id research/web-search --version 1.0.0 \
  --hub https://hub.example --share public --scope project
```

## Repository Node fleet

Hub-enabled repositories use distinct repository-node services and health records. `lervo repository node plan` is read-only; exact `repository node apply` installs or transactionally upgrades the shipped self-contained runtime and commits the owner-only fleet registry only after stable complete readiness. `lervo repository node status` reports service, event sync, workstream replication, remote control, freshness, and recovery per project. Local execution continues when the optional Hub is unavailable.

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

Durable records live under `.lervo/data`; rebuildable projections live under `.lervo/state`. Inspect with `lervo state status`; reset through the plan-first `lervo state reset`. See the [state lifecycle specification](docs/specifications/execution/state-lifecycle.md).

## Repository knowledge

See the [compilation specification](docs/specs/repository-knowledge-compilation.md). Run `lervo migrate knowledge` before using the local `docs/knowledge/index.md` projection.

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

Commit messages follow [the repository commit convention](docs/foundation/commit-convention.md). Source and configuration files follow the [code convention](docs/foundation/code-convention.md).

```bash
pnpm quality:check
pnpm typecheck
pnpm test
pnpm docs:check
pnpm build
```

Run `pnpm check` for the full release-oriented suite.

## Status

Lervo is pre-1.0. The v0 scope—local managed execution, repository knowledge, and optional Hub/node runtimes—is implemented, but interfaces may change before a stable release.
