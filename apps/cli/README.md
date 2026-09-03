# @lervo/cli

Lervo manages local AI-agent execution, evidence, and repository knowledge. Initialization, knowledge operations, and help do not require a Hub.

## Requirements

Node.js 22.13 or later.

## Install

```sh
npm install --global @lervo/cli
```

From a built checkout:

```sh
pnpm install
pnpm build
npm install --global ./apps/cli
lervo --version
```

## First use

Run from the repository root:

```sh
lervo init --name my-project
lervo upgrade
lervo knowledge lint
lervo knowledge query "architecture"
lervo --help
```

Preview initialization with `lervo init --dry-run --name my-project`. Initialization completes safe generated stages, creates the initial developer agent, and reports remaining authority boundaries. Migration preserves user bytes without exact approval.

After installing a newer CLI, `lervo upgrade` plans capability, knowledge, hook-runtime, lint, and registered-Node reconciliation. Apply its exact plan; user and provider authority remains separate.

## Semantic knowledge

Codex and Claude independently create no-tool, unreviewed candidates:

```sh
lervo knowledge compile --provider claude
lervo knowledge compile --provider codex
lervo knowledge compare --codex <codex-compilation-id> --claude <claude-compilation-id>
lervo knowledge review-policy --reviewer human.owner --write
lervo knowledge review <compilation-id> --plan <plan-id> \
  --policy .lervo/knowledge/review-policies/knowledge_semantic_review.default.yaml \
  --reviewer human.owner --accept-all-safe
lervo knowledge materialize <review-id>
```

Compilation does not prove truth. Conflicts and managed-block changes require exact approval.

## Documents and provider entrypoints

Use `lervo knowledge structure delete|move|split|merge` with the reviewed plan ID and every required exact item approval. Use `lervo knowledge normalize` for the reviewed content stage; it is also available through `migrate knowledge --provider`.

`lervo knowledge instruction bridge --provider claude` keeps `AGENTS.md` canonical and manages only the `@AGENTS.md` bridge in `CLAUDE.md`.

## Exchange and managed execution

Use `lervo knowledge export okf` and `lervo knowledge import okf` for OKF v0.2 bundles. Imports remain read-only until exact apply.

`lervo run` keeps document and knowledge searches separate. Selected sources require current-byte validation and adapter delivery receipts; later use is not inferred.

External products discover the no-Hub boundary with `lervo application capabilities --json`. It grants no UI, database, scheduling, approval, provider, or connector authority.

Configure a provider and tracked suite under `.lervo/verifications/`, then use the one-file managed boundary:

```sh
lervo run --provider codex --path src/example.ts --verification project.quick \
  "Implement the requested change"
lervo run --provider claude --path src/example.ts --verification project.quick \
  "Review and update the requested change"
```

The suite and result checks must pass. Result prose is evaluated in a read-only local provider session. See `lervo --help` for all commands.

Built-in and validated repository roles use this boundary. `lervo role list|show|validate` inspects exact contracts; workforce commands manage agents and handoffs.

`lervo capability validate|install|list|resolve|migrate` manages immutable skill, MCP, plugin, and bundle packages locally. Discovery is deterministic; evidence separates recommendation, selection, load, activation, invocation, and completion. Migration preserves `.agents/skills` hashes and never copies provider secrets. Optional Hub publish/pull requires named credentials and exact approval.

Durable event, CAS, and workforce data lives under `.lervo/data`. `lervo state status` inspects rebuildable `.lervo/state`; `lervo state reset` requires an exact approval plan and preserves durable data. Workstream state reconstructs from its latest event and CAS artifact.

For Hub-enabled repositories, `lervo repository node plan|apply|status` manages repository-node services through exact plans and owner-only external configuration.
