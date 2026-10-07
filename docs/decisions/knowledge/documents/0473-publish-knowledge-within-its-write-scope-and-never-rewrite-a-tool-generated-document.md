# ADR-0473: Publish knowledge within its write scope and never rewrite a tool-generated document

Status: `accepted`
Decision date: 2026-10-06
Amends: [ADR-0466](../../coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md), [ADR-0469](../../coordination/sync/0469-keep-background-knowledge-continuous-on-every-host.md), and [ADR-0195](../repository/0195-reviewed-document-content-normalization.md)
Amended by: [ADR-0491](../semantics/0491-never-pin-tool-generated-files-as-assets-and-memoize-the-role-registry.md) (package-manager lockfile evidence)

## Context

A WSL owner host running CLI 0.20.0 (main `f9cb5a3a`) showed three defects in one repository:

- **Publication scope disagreed with write scope.** Derivation wrote `allowedRoots: ["docs/", ".lervo/knowledge/"]`. The active delegation's `normalizationRoots` also covered `README.md`, `AGENTS.md`, `.agents/skills`, `.claude/skills`, and `.codex/skills`, and a reviewed normalization changed `apps/site/README.md`. Publication then failed with `knowledge_publication_scope_violation` ("4 path(s) outside the allowed roots"), although every write had been reviewed.
- **Generated files were normalized.** `apps/app/CHANGELOG.md`, `apps/site/CHANGELOG.md`, and `apps/web-next/CHANGELOG.md` are written by release-please, which the repository declares in `release-please-config.json` and `.release-please-manifest.json`. Knowledge commit `9472c2d793` reflowed them and changed the capitalization of historical commit subjects.
- **Recovery required the owner.** The `action_required` attention asked the owner to revert the commit by hand, and publication stayed blocked until someone did.

A second host showed a fourth defect: derivation took the base branch from the local `refs/remotes/origin/HEAD`. On one checkout that ref pointed to a feature branch, so publication targeted it. On another checkout the ref was missing, so publication stayed `unavailable`. Derived settings were never probed again.

## Decision

### Publication follows the knowledge write scope

Publication settings gain `scope: "delegation"`, which cannot be combined with `allowedRoots`. Under this scope, a path is publishable when it is Lervo-managed knowledge state (`.lervo/knowledge/` or the managed knowledge roots) or lies within the active, unexpired delegation's `canonicalRoots` or `normalizationRoots`. These are the same roots that bound normalization, canonical integration, and lifecycle writes. Without an active delegation, only Lervo-managed knowledge state is publishable. A freshness commit outside these roots is publishable only when the local freshness candidate records that commit, or records a revert. Settings that name `allowedRoots`, or omit both fields, keep the fixed-prefix behavior.

The last unpublished knowledge commit that changed a path decides that path. A path is a violation when a repository tool generates it, or when the scope does not admit it, unless that last commit is a repair commit.

### Derived settings are revalidated

The derivation probe reads the remote's own default branch with `git ls-remote --symref origin HEAD`, never the local `origin/HEAD`. It writes `scope: "delegation"`. For a configuration Lervo derived, the probe runs again on the existing six-hour interval even when publication is already configured, so a wrong or changed base is corrected. A failed probe keeps the current setting. A derived setting that still holds the old fixed default roots migrates to `scope: "delegation"` at the next reconciliation, without a probe. Operator-written configurations are never changed. Publication is probed and kept only for proven Hub coordinates; a host that [ADR-0471](../../coordination/sync/0471-keep-cross-host-knowledge-ownership-safe-when-hub-coordination-fails.md) holds in unproven Hub mode gains no publication setting.

### Tool-generated documents have their own owner

`lifecycleOwner: tool_generated` joins the document-layout role contract. A document is tool-generated when the repository supplies at least one kind of evidence:

| Evidence                  | Source                                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `layout_role`             | A document-layout role with `lifecycleOwner: tool_generated`                                                                |
| `generator_configuration` | `release-please-config.json` and `.release-please-manifest.json`: each package's `changelog-path`                           |
| `repository_attribute`    | `linguist-generated` set through `.gitattributes`                                                                           |
| `generated_marker`        | An `@generated` tag or a `Code generated ... DO NOT EDIT.` header within the first five lines                               |
| `tool_commit_history`     | Every non-Lervo, non-merge commit among the last 512 that touched the path has a GitHub App or bot identity (`<name>[bot]`) |

No evidence comes from a file name. A single commit by a person makes history evidence fail, so the document stays user-owned. Every probe is read-only and treats missing or unreadable evidence as user ownership.

Normalization never offers a tool-generated document. That covers inspection, preflight, compilation, and plan validation. Freshness observation proposes no refresh for one, and publication refuses a rewrite of one.

### The owner repairs its own commits

Before publishing, the convergence owner plans a repair. Its candidates are tool-generated paths that recent `Lervo Knowledge` commits changed (the last 256), and unpublished paths outside the scope. For each path, the newest commits that are all non-merge `Lervo Knowledge` commits form Lervo's run:

- A tool-generated path returns to the parent of the oldest commit in the run. This applies even when the rewrite was already published.
- An out-of-scope path returns to the remote base. Every commit after the base that touched the path must be in the run.
- The normalization records of a restored tool-generated document, and outputs other than its source, follow the same rule. In practice, they are deleted.

The repair is blocked, and the path stays as it is, in four cases:

- `developer_change`: a person or tool committed to the path after Lervo's run while an unpublished Lervo change remains.
- `reviewed_freshness`: a freshness commit lies in the run of an out-of-scope path.
- `uncommitted_change`: the path has uncommitted edits.
- `history_unavailable`: the run reaches past the 64 commits read, or reaches a root commit.

Restorations land in one `Lervo Knowledge` commit, `docs: restore paths the knowledge lifecycle must not change`. Its body lists each path with its reason, and it carries one `Lervo-Publication-Repair: <sha>` trailer for each undone commit (at most 64), plus the host trailer. The repair touches only Lervo's own changes and rewrites no history: the earlier commits stay, and publication carries the repair commit with them.

## Event and state

`knowledge.publication.repaired` (event schema 4) is appended once for each repair commit. The event ID is derived from the commit, so a retried append is deduplicated.

| Field                    | Meaning                                                                         |
| ------------------------ | ------------------------------------------------------------------------------- |
| `repairCommit`           | The corrective commit (40 hex characters)                                       |
| `repairedCommits`        | The `Lervo Knowledge` commits whose changes were undone (1 to 64)               |
| `toolGeneratedPathCount` | Restored tool-generated documents                                               |
| `outsideScopePathCount`  | Restored out-of-scope paths                                                     |
| `normalizationPathCount` | Retired normalization records and extra outputs                                 |
| `pathSetHash`            | `sha256` of the sorted restored paths                                           |
| `hostHash`               | The committing owner's host hash, or null for a host without owner coordination |
| `occurredAt`             | Commit observation time                                                         |

**Privacy:** the event carries no path, no content, no label, and no remote. Paths remain in Git, where the commit body already records them.

**Failure meaning:** the commit and its trailers are canonical. A store that cannot accept schema-4 events, or a publisher without an event store (`lervo knowledge convergence owner publish` opens one), loses only the audit line. A failed repair rolls the touched paths back to `HEAD` and publishes nothing, so the scope check still refuses those paths.

`knowledge_publication_scope_violation` remains the only failure code. Its path-free detail now counts out-of-scope and tool-owned paths and names the repair blockers, for example `1 path(s) outside the knowledge write scope, 0 tool-owned path(s); automatic repair blocked: 1 developer_change`. Attention asks the owner to act only for `developer_change` and `uncommitted_change`.

## Consequences

- A reviewed write under any delegated root publishes without operator configuration.
- An unreviewed path still never publishes. A path that only Lervo touched is restored automatically. Other paths wait for the owner.
- Publication may carry a net-empty pull request when a repair undoes an unpublished commit. It is merged like any other publication, and it keeps both commits auditable.
- Repair cannot recover tool output that a tool rewrote after Lervo's change. Lervo never overwrites that output, so it stays as the tool wrote it.
- Changesets and other generators without a declared configuration rely on history, attribute, marker, or layout-role evidence.

## Verification

Focused tests must show:

- Release-please changelog paths, markers, bot identities, layout roles, `.gitattributes`, and history each produce evidence, and one human commit defeats history evidence.
- Normalization inspection and freshness observation skip a tool-generated document.
- The delegation scope admits delegated roots and managed state, admits only managed state without an active delegation, and refuses an unverifiable freshness commit.
- The probe reads `ls-remote --symref`. Derivation corrects a wrong derived base after the interval, keeps it when the probe fails, migrates the old fixed roots, and leaves operator configurations byte-identical.
- An out-of-scope knowledge commit is restored and published, with a trailer and one event. A published release-please changelog rewrite is restored and its record retired. A path a developer also changed is refused with `developer_change`, and the developer's bytes are kept.
