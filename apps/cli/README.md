# @lervo/cli

Lervo manages local AI-agent execution, evidence, and repository knowledge. Initialization, knowledge operations, and help require no Hub.

## Requirements and installation

Requires Node.js 22.13+.

```sh
npm install --global @lervo/cli
```

From a checkout:

```sh
pnpm install
pnpm build
npm install --global ./apps/cli
lervo --version
```

## First use

From the repository root:

```sh
lervo init --name my-project
lervo upgrade
lervo knowledge lint
lervo knowledge query "architecture"
lervo --help
```

Preview with `lervo init --dry-run --name my-project`. Initialization completes safe generated stages, creates the initial developer agent, and reports remaining authority boundaries. Migration preserves user bytes without exact approval.

After installing a newer CLI, run `lervo upgrade`, review its exact reconciliation plan, then apply it. User and provider authority remain separate.

An owner-authorized signed webhook can materialize a fixed assignment routine with `lervo trigger webhook serve --config <config.json>`. The listener is loopback-only; external payloads never become assignment instructions, and provider execution remains separate.

After assignments are queued and compatible agents are hired, `lervo loop schedule --provider codex --write` can poll, exact-revision claim, and managed-execute them within finite cycle, claim, run, time, retry, budget, lease, and kill-switch bounds. It works locally without a Hub and does not grant approval, cancellation, dynamic graph, or in-flight preemption authority.

## Workflows

- [Knowledge review, document ownership, and exchange](https://github.com/kimjh96/lervo/blob/main/docs/knowledge/repository/knowledge.md)
- [Managed execution, capabilities, and local state](https://github.com/kimjh96/lervo/blob/main/docs/execution/orchestration/execution.md)
