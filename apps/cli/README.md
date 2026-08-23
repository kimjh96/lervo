# @lervo/cli

Lervo manages local AI-agent execution, evidence, and repository knowledge. Initialization, knowledge operations, and help do not require a Hub.

## Requirements

- Node.js 22.13 or later

## Install

From the registry:

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

For a relocatable archive, run `pnpm --dir apps/cli pack --pack-destination <directory>` and install the resulting `.tgz`.

## First use

Run from the repository root:

```sh
lervo init --name my-project
lervo migrate knowledge
# Review the plan ID, then apply the same current plan.
lervo migrate knowledge --apply <plan-id>
# After layout, bridge, and structural stages are current:
lervo migrate knowledge --provider codex
# Review the stored candidate, then apply every displayed item approval.
lervo migrate knowledge --candidate <candidate-id> --apply <plan-id> \
  --approve-item <operation-id>=<approval-hash>
lervo knowledge lint
lervo knowledge query "architecture"
lervo --help
```

`lervo init --dry-run --name my-project` previews the minimum tracked contract. Runtime and feature directories are created only when first used.

Structural migration preserves user bytes unless an exact move or update is approved. Normalization uses installed Codex or Claude without tools to store an English, audience-profiled candidate. Apply does not rerun the provider and requires exact approval for every source document. Migration is complete when normalization lifecycle records are current and replanning finds no pending documents.

## Semantic knowledge

Codex and Claude can independently produce no-tool, unreviewed semantic candidates:

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

Compilation does not prove truth. Conflicts and managed-block changes require exact approval. Recover interrupted apply with `lervo knowledge materialize --recover`.

## Documents and provider entrypoints

Use `lervo knowledge structure delete|move|split|merge` with the reviewed plan ID and all required exact item approvals. Use `lervo knowledge normalize` for the reviewed content stage also exposed by `migrate knowledge --provider`.

`lervo knowledge instruction bridge --provider claude` keeps `AGENTS.md` canonical and manages only the `@AGENTS.md` bridge in `CLAUDE.md`.

## Exchange and managed execution

Use `lervo knowledge export okf` and `lervo knowledge import okf` for OKF v0.2 bundles. Import stays read-only until exact apply.

`lervo run` keeps document and knowledge searches separate. Selected sources require current-byte validation and adapter delivery receipts; later use is not inferred.

Configure a provider and tracked suite under `.lervo/verifications/`, then run through the one-file managed boundary:

```sh
lervo run --provider codex --path src/example.ts --verification project.quick \
  "Implement the requested change"
lervo run --provider claude --path src/example.ts --verification project.quick \
  "Review and update the requested change"
```

The declared suite and result-publication checks must pass. Result prose is evaluated in a separate, read-only local provider session using an empty temporary repository. See `lervo --help` for the current command surface.
