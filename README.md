# Lervo

Lervo makes AI-assisted repository work durable and inspectable. It runs locally without a Hub and gives Codex and Claude a shared execution and evidence model. Repository files remain the source of truth; generated indexes can be rebuilt. See the [product vision](docs/product/vision.md) and [system architecture](docs/architecture/system.md).

## Start locally

```bash
pnpm install
pnpm build
npm install --global ./apps/cli
lervo init
```

For an existing repository, use the [repository upgrade guide](docs/roadmap/onboarding/repository-upgrade.md). The [CLI guide](apps/cli/README.md) covers first use and available workflows.

## Work with Lervo

- [Managed execution and evidence](docs/specifications/execution.md) describes provider adapters, verification, direct-terminal limits, and result publication.
- [Repository knowledge](docs/specs/repository-knowledge-compilation.md) describes source discovery, reviewed migration, document ownership, query, and lint.
- [Agent organization](docs/architecture/system/agent-organization.md) describes roles, assignments, and handoffs.
- [Capability packages](docs/specifications/execution/capabilities.md) describes selection, loading, activation, and use evidence.
- [Optional Hub and repository nodes](docs/architecture/system/hub-and-nodes.md) describes coordination beyond local execution.

## Repository guidance

Agents should follow [AGENTS.md](AGENTS.md). The [v0 roadmap](docs/roadmap/v0.md) records delivered scope and links active follow-up work. Commit messages follow the [commit convention](docs/foundation/commit-convention.md), and source changes follow the [code convention](docs/foundation/code-convention.md).
