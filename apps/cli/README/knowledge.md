# Knowledge and documents

## Semantic review

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

Use `lervo knowledge structure delete|move|split|merge` with the reviewed plan and exact item approvals. Use `lervo knowledge normalize` for reviewed content; it is also available through `migrate knowledge --provider`.

`lervo knowledge instruction bridge --provider claude` keeps `AGENTS.md` canonical and manages only the `@AGENTS.md` bridge in `CLAUDE.md`.
