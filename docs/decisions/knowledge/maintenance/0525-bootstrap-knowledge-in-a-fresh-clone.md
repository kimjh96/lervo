# ADR-0525: Bootstrap knowledge in a fresh clone

Status: `accepted`
Decision date: 2026-10-21

## Context

Git ignores every generated knowledge output: structural records under `.lervo/state/knowledge/` and navigation under the publication root ([ADR-0303](../repository/canonicalization/0303-branch-safe-knowledge-reconciliation-and-canonicalization.md)). A colleague who clones a Lervo repository therefore starts with none of it.

A fresh clone of this repository on 2026-10-20 showed what that colleague's agent saw:

- The tracked Claude Code hook ran without a global Lervo CLI and injected its context in 4.4 seconds. It did not build knowledge and did not mention that knowledge was missing.
- `lervo knowledge query` returned zero recommendations with no warning.
- `lervo knowledge lint` reported `valid: true`.
- `lervo migrate knowledge` took about 67 seconds and changed no tracked file. Queries worked afterwards.

An agent cannot tell "nothing matched" from "nothing was built", so it works without the repository knowledge its instructions require until someone builds it by hand. Background maintenance does not cover this case, because it runs only on hosts with a registered Node or knowledge worker.

## Decision

### Report the unbuilt state

A checkout is unbuilt when it has no applied structural generation manifest.

- `lervo knowledge query --json` adds `knowledgeBuild: "built" | "not_built"`. Text output adds one line saying that zero recommendations do not mean zero matches and naming `lervo migrate knowledge`.
- `lervo knowledge lint` keeps its `missing_generation_manifest` warning and now says that a fresh clone starts there.

### Tell the agent and build in the background

On `UserPromptSubmit`, the terminal hook appends one line to the prepared context when the checkout is unbuilt, and starts at most one detached build. The hook never waits for it: the hook timeout is 30 seconds, and a build of this repository takes about a minute.

The build runs from the bundled hook runtime, so it needs no global CLI. It plans an ordinary knowledge refresh and applies it only when every changed operation is Lervo-generated and lies under `.lervo/state/knowledge/` or the publication root. A plan that touches a tracked path, such as `.gitignore`, `AGENTS.md`, or a user document, or that is not ready, is never applied. The hook then tells the agent to ask the owner to review `lervo migrate knowledge`. Refresh mode never proposes layout moves, which need owner review.

The applied build goes through the same apply, lint, and rollback path as `lervo knowledge refresh`. It records the existing schema-1 `knowledge.materialization.applied` event with `operation: refresh`. Both paths share one event builder. The build adds no event type.

### Local progress state

`.lervo/state/knowledge/bootstrap.json` holds the build's local progress. It is Git-ignored, rebuildable, and never canonical.

| Field       | Meaning                                                                       |
| ----------- | ----------------------------------------------------------------------------- |
| `status`    | `in_progress`, `built`, `deferred`, or `failed`                               |
| `updatedAt` | Time of the last transition                                                   |
| `reason`    | `tracked_paths_in_plan`, `migration_apply_failed`, `bootstrap_error`, or null |

The file holds no paths, content, prompts, or provider identity.

- `in_progress` suppresses new builds for 15 minutes.
- `failed` waits one hour before the next prompt retries.
- `deferred` persists until the knowledge is built.
- An applied generation always wins over a concurrent failure.

## Consequences

A colleague's first prompt says that knowledge is building, and later prompts receive normal retrieval without any manual step. The build costs about a minute of local CPU once per clone in this repository. Smaller repositories take less.

A clone that would need tracked changes stays unbuilt and says so, instead of silently editing the colleague's working tree.

The hook runtime bundle grows by about 5 KB and stays under its 8 MiB budget, with about 29 KB to spare. Moving the event builder into a shared module avoided pulling the full migration command into the bundle.

## Verification

- Bootstrap tests build a fresh clone of a migrated fixture without changing `AGENTS.md`, and defer when the plan would create a tracked entrypoint.
- Hook notice tests start one build, suppress a second build within the window, and fall back to a manual instruction without a hook runtime.
- Unit tests reject tracked entrypoints, `.gitignore`, user files and conflicts under the publication root, sibling paths, other local state, and plans that are not ready.
- The query test reports `knowledgeBuild: "not_built"` for an unbuilt checkout.
- An end-to-end fresh clone with the rebuilt hook runtime reported the notice on the first prompt and finished the build about 37 seconds later. It changed no tracked file, created 79 navigation pages, linted valid with zero errors, and returned 20 recommendations. The second prompt carried no notice.
