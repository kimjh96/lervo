# ADR-0473: Publish knowledge within its write scope and never rewrite a tool-generated document

Status: `accepted`
Decision date: 2026-10-06
Amends: [ADR-0466](../../coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md), [ADR-0469](../../coordination/sync/0469-keep-background-knowledge-continuous-on-every-host.md), and [ADR-0195](../repository/0195-reviewed-document-content-normalization.md)
Amended by: [ADR-0491](../semantics/0491-never-pin-tool-generated-files-as-assets-and-memoize-the-role-registry.md) (package-manager lockfile evidence), [ADR-0594](../maintenance/0594-keep-knowledge-publication-moving-and-apply-owner-rules-on-every-host.md) (default roots widen to an active delegation; skill files publish only from practice)

## Context

A WSL owner host running CLI 0.20.0 (main `f9cb5a3a`) exposed three defects in one repository:

- **Publication scope disagreed with write scope.** Derivation wrote `allowedRoots: ["docs/", ".lervo/knowledge/"]`, while the active delegation's `normalizationRoots` also covered `README.md`, `AGENTS.md`, `.agents/skills`, `.claude/skills`, and `.codex/skills`. Reviewed normalization changed `apps/site/README.md`. Publication failed with `knowledge_publication_scope_violation` ("4 path(s) outside the allowed roots"), although every write had been reviewed.
- **Generated files were normalized.** Release-please owns `apps/app/CHANGELOG.md`, `apps/site/CHANGELOG.md`, and `apps/web-next/CHANGELOG.md`, as declared in `release-please-config.json` and `.release-please-manifest.json`. Knowledge commit `9472c2d793` reflowed them and changed historical commit-subject capitalization.
- **Recovery required the owner.** The `action_required` attention requested a manual revert; publication remained blocked until someone performed it.

A second host exposed a fourth defect: derivation used local `refs/remotes/origin/HEAD` for the base branch. One checkout pointed to a feature branch, which became the publication target. Another lacked the ref, leaving publication `unavailable`. Derived settings were never probed again.

## Decision

### Publication follows the knowledge write scope

Publication settings gain `scope: "delegation"`, mutually exclusive with `allowedRoots`. This scope admits:

- Lervo-managed knowledge state: `.lervo/knowledge/` or the managed knowledge roots.
- Paths within the active, unexpired delegation's `canonicalRoots` or `normalizationRoots`, which also bound normalization, canonical integration, and lifecycle writes.

Without an active delegation, only Lervo-managed knowledge state is publishable. A freshness commit outside these roots is publishable only when the local freshness candidate records that commit or records a revert. Settings that specify `allowedRoots`, or omit both fields, retain fixed-prefix behavior.

The last unpublished knowledge commit that changed a path determines its eligibility. A path violates publication rules if a repository tool generates it or the scope excludes it, unless that last commit is a repair commit.

### Derived settings are revalidated

The derivation probe reads the remote's default branch with `git ls-remote --symref origin HEAD`, never local `origin/HEAD`, and writes `scope: "delegation"`.

For Lervo-derived configurations, the probe repeats on the existing six-hour interval even when publication is configured, correcting a wrong or changed base. Probe failure preserves the current setting. A derived setting with the old fixed default roots migrates to `scope: "delegation"` at the next reconciliation without a probe. Operator-written configurations are never changed.

Publication is probed and retained only for proven Hub coordinates. A host held in unproven Hub mode by [ADR-0471](../../coordination/sync/0471-keep-cross-host-knowledge-ownership-safe-when-hub-coordination-fails.md) gains no publication setting.

### Tool-generated documents have their own owner

`lifecycleOwner: tool_generated` joins the document-layout role contract. A document is tool-generated when the repository supplies at least one of these evidence types:

| Evidence | Source |
| --- | --- |
| `layout_role` | A document-layout role with `lifecycleOwner: tool_generated` |
| `generator_configuration` | Each package's `changelog-path` in `release-please-config.json` and `.release-please-manifest.json` |
| `repository_attribute` | `linguist-generated` set through `.gitattributes` |
| `generated_marker` | An `@generated` tag or `Code generated ... DO NOT EDIT.` header within the first five lines |
| `tool_commit_history` | Every non-Lervo, non-merge commit among the last 512 touching the path has a GitHub App or bot identity (`<name>[bot]`) |

File names provide no evidence. A single human commit defeats history evidence, leaving the document user-owned under that evidence test. Every probe is read-only and treats missing or unreadable evidence as user ownership.

Normalization never offers tool-generated documents, including during inspection, preflight, compilation, and plan validation. Freshness observation proposes no refresh for them; publication refuses their rewrite.

### The owner repairs its own commits

Before publication, the convergence owner plans a repair. Candidates are tool-generated paths changed by the last 256 `Lervo Knowledge` commits and unpublished paths outside the scope. For each path, the newest commits that are all non-merge `Lervo Knowledge` commits form Lervo's run:

- A tool-generated path returns to the parent of the run's oldest commit, even if the rewrite was already published.
- An out-of-scope path returns to the remote base. Every commit after the base that touched the path must belong to the run.
- Normalization records for a restored tool-generated document, and outputs other than its source, follow the same rule. In practice, they are deleted.

Repair is blocked and the path remains unchanged in four cases:

| Blocker | Condition |
| --- | --- |
| `developer_change` | A person or tool committed to the path after Lervo's run while an unpublished Lervo change remains. |
| `reviewed_freshness` | A freshness commit lies in an out-of-scope path's run. |
| `uncommitted_change` | The path has uncommitted edits. |
| `history_unavailable` | The run extends beyond the 64 commits read or reaches a root commit. |

Restorations land in one `Lervo Knowledge` commit titled `docs: restore paths the knowledge lifecycle must not change`. Its body lists each path and reason. It carries one `Lervo-Publication-Repair: <sha>` trailer per undone commit (at most 64), plus the host trailer.

Repair touches only Lervo's own changes and never rewrites history. Earlier commits remain, and publication carries the repair commit with them.

## Event and state

`knowledge.publication.repaired` (event schema 4) is appended once per repair commit. Its ID derives from the commit, deduplicating retried appends.

| Field | Meaning |
| --- | --- |
| `repairCommit` | Corrective commit (40 hex characters) |
| `repairedCommits` | `Lervo Knowledge` commits whose changes were undone (1 to 64) |
| `toolGeneratedPathCount` | Restored tool-generated documents |
| `outsideScopePathCount` | Restored out-of-scope paths |
| `normalizationPathCount` | Retired normalization records and extra outputs |
| `pathSetHash` | `sha256` of the sorted restored paths |
| `hostHash` | Committing owner's host hash, or null for a host without owner coordination |
| `occurredAt` | Commit observation time |

**Privacy:** The event contains no path, content, label, or remote. Paths remain in Git, where the commit body records them.

**Failure behavior:** The commit and trailers are canonical. A store unable to accept schema-4 events, or a publisher without an event store, loses only the audit line. `lervo knowledge convergence owner publish` opens an event store. A failed repair rolls touched paths back to `HEAD` and publishes nothing; the scope check continues to refuse those paths.

`knowledge_publication_scope_violation` remains the only failure code. Its path-free detail counts out-of-scope and tool-owned paths and names repair blockers, for example: `1 path(s) outside the knowledge write scope, 0 tool-owned path(s); automatic repair blocked: 1 developer_change`. Attention requests owner action only for `developer_change` and `uncommitted_change`.

## Consequences

- Reviewed writes under any delegated root publish without operator configuration.
- Unreviewed paths never publish. Paths touched only by Lervo are restored automatically; other paths wait for the owner.
- Repairing an unpublished commit may produce a net-empty publication pull request. It is merged like any other publication, keeping both commits auditable.
- Repair cannot recover tool output rewritten by a tool after Lervo's change. Lervo never overwrites that output; it remains as the tool wrote it.
- Changesets and other generators without declared configuration rely on history, attribute, marker, or layout-role evidence.

## Verification

Focused tests must demonstrate:

- Release-please changelog paths, markers, bot identities, layout roles, `.gitattributes`, and history each produce evidence; one human commit defeats history evidence.
- Normalization inspection and freshness observation skip tool-generated documents.
- Delegation scope admits delegated roots and managed state, admits only managed state without an active delegation, and refuses unverifiable freshness commits.
- The probe reads `ls-remote --symref`. Derivation corrects a wrong derived base after the interval, preserves it on probe failure, migrates old fixed roots, and leaves operator configurations byte-identical.
- An out-of-scope knowledge commit is restored and published with a trailer and one event. A published release-please changelog rewrite is restored and its record retired. A path also changed by a developer is refused with `developer_change`, preserving the developer's bytes.
