# @lervo/cli

Lervo manages AI-agent execution and evidence inside a local repository. Initialization, repository knowledge, and help work without a Hub.

## Requirements

- Node.js 22.13 or later

## Install

From the registry after publication:

```sh
npm install --global @lervo/cli
```

From a built Lervo checkout without publishing to npm:

```sh
pnpm install
pnpm build
npm install --global ./apps/cli
lervo --version
```

For a relocatable archive, run `pnpm --dir apps/cli pack --pack-destination <directory>` and install the resulting `.tgz`.

## First use

Run these commands from the repository root:

```sh
lervo init --name my-project
lervo migrate knowledge
# Review the plan ID, then apply the same current plan.
lervo migrate knowledge --apply <plan-id>
lervo knowledge lint
lervo knowledge query "architecture"
lervo --help
```

`lervo init --dry-run --name my-project` previews the minimum tracked contract. Feature and runtime directories appear only when first used.

Migration preserves existing user bytes. Structural moves require exact approval, and a completed migration replans with no changes.

## Semantic knowledge

Codex and Claude can independently create no-tool, unreviewed semantic candidates:

```sh
lervo knowledge compile --provider claude
lervo knowledge compile --provider codex
lervo knowledge compare --codex <codex-compilation-id> --claude <claude-compilation-id>
lervo knowledge stability --provider codex
lervo knowledge reconcile <compilation-id>
lervo knowledge review-policy --reviewer human.owner --write
lervo knowledge review <compilation-id> --plan <plan-id> \
  --policy .lervo/knowledge/review-policies/knowledge_semantic_review.default.yaml \
  --reviewer human.owner --accept-all-safe
lervo knowledge materialize <review-id>
```

Compilation does not prove truth. Conflicts and managed-block changes require exact approval; recover an interrupted apply with `lervo knowledge materialize --recover`.

## Documents and provider entrypoints

Use `lervo knowledge structure delete|move|split|merge` with the reviewed plan ID and every required exact item approval. MDX and instruction user regions are not rewritten.

`lervo knowledge instruction bridge --provider claude` keeps `AGENTS.md` canonical and manages only the `@AGENTS.md` bridge in `CLAUDE.md`.

## Exchange and managed execution

`lervo knowledge export okf` and `lervo knowledge import okf` exchange OKF v0.2 bundles. Import remains read-only until exact apply.

`lervo run` keeps document and knowledge searches separate. Selected sources require current-byte validation and adapter delivery receipts; later use is not inferred.

Configure the provider and a tracked suite under `.lervo/verifications/`, then run an agent through the one-file managed boundary:

```sh
lervo run --provider codex --path src/example.ts --verification project.quick \
  "Implement the requested change"
lervo run --provider claude --path src/example.ts --verification project.quick \
  "Review and update the requested change"
```

The declared project suite and result-publication checks must pass. Result prose is evaluated in a separate read-only local provider session that uses an empty temporary repository. See `lervo --help` for the current command surface.
