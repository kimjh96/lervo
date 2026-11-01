# Operating attention report contract

`lervo application attention --json` returns an `OperatingAttentionReportV1` with:

- Project and current workstream revision coordinates.
- A stable report digest excluding observation time.
- Explicit workstream, canonicalization-registry, and knowledge-lifecycle coverage.
- Bounded, typed items with action owner, user-authority requirement, blocking state, and next instruction.
- All, omitted, blocking, user-action, and stale item counts.

The projection includes pending workstream decisions and approvals, workstream blockers, nonterminal canonicalization candidates, and current knowledge-lifecycle issues. Workstream approvals and decisions carry a consequence class: `repository_write`, `deployment`, `external_effect`, or, for decisions, `unclassified`. An unclassified decision requires principal-proxy classification; it does not prove a consequential effect. [ADR-0535](../../../decisions/execution/applications/0535-project-core-health-with-actor-owned-attention.md) adds [actor attribution and repository health](repository-health.md), retaining original guidance as `recordedInstruction`. Only structured consequential effects remain user-actionable.

Items are deduplicated by stable item ID, ordered with user-authority and blocking items first, and capped at 256 returned records. Classification and totals cover every loaded freshness candidate before this cap;
there is no earlier 16-candidate cutoff. `summary.byKind` retains total and
user-action counts per kind, and `summary.truncatedCount` is exact. Omitted
candidates remain inspectable with `lervo knowledge freshness review <candidate-id>`
and `lervo knowledge freshness status`; the application command retains the
bounded current report.

## Workstream and canonicalization candidates

Under [ADR-0462](../../../decisions/execution/applications/0462-own-workstream-bookkeeping-and-stale-attention.md), a workstream snapshot is stale if:

- Its update time is older than 48 hours.
- Its recorded HEAD is more than 20 commits behind or is not an ancestor of the current HEAD. The distance counts non-merge commits by authors other than Lervo knowledge and release preparation ([ADR-0555](../../../decisions/execution/applications/0555-keep-operating-signals-visible-and-honest.md)).
- Its update time is in the future.

The optional `workstream` section of `.lervo/knowledge/policy.yaml` configures both thresholds. Every stale-workstream item has `state: "stale"`, `blocking: false`, `requiresUserAction: false`, owner `agent`, and an instruction to re-verify against the repository instead of presenting it as current.

Candidate items expose outcome kind, proposed target paths, and whether proposed content exists, never the summary or proposed Markdown body. Promoted and rejected candidates are terminal and excluded.

## Document drift

Under [ADR-0464](../../../decisions/knowledge/documents/0464-report-document-drift-and-historical-documents.md), document drift warnings from `lervo knowledge lint` appear as knowledge-lifecycle items: at most four warnings plus one overflow item. Each is agent-owned, non-blocking, and requires no user action. Detail contains only relative paths and reason names. Drift warnings remain separate from lifecycle gates and never change terminal lifecycle status.

## Document freshness

[ADR-0463](../../../decisions/knowledge/documents/0463-refresh-stale-documents-with-evidence-bound-minimal-edits.md) defines three item kinds:

- `document_freshness_candidate`: a verified held candidate, attributed to the resident freshness cycle unless pending hunks concern user-owned bytes, owner-authorized writes or safety/policy. Only those consequential effects require user action; the item is never blocking.
- `document_freshness_applied`: an informational, agent-owned apply notice naming the revert command; resolves on acknowledgement or after 24 hours.
- `document_freshness_blocked`: reports five attempts with no verified candidate in one day.

These items carry candidate identifiers, relative paths, classes, and counts, never hunk text. The projection reads rebuildable freshness state in `lervo application attention` and on the cached retrieval prompt path. Unreadable state contributes no item. The compact prompt reads the shared health projection instead of rendering a freshness-review chore.

## Owner-turn capture

[ADR-0467](../../../decisions/knowledge/documents/0467-capture-owner-turns-semantically-in-the-knowledge-resident.md) defines:

- `durable_instruction_candidate`: an exact-review instruction candidate carrying its source (`terminal_prompt`, `conversation`, or `explicit_intake`), normalized title, target path, and hash-bound review command.
- `captured_decision`: a held owner decision or rule needing the owner's confirmation, with a dismiss command.

Instruction candidates belong to the instruction reviewer; held settled decisions belong to the principal proxy. Neither is owner-actionable merely because review is pending. Both are non-blocking and carry normalized titles, never owner or agent turn text. Existing review and write authority remains required before applying a candidate.

`instruction_capture_blocked` appears once per host while owner turns are queued but the host lacks delegation to assess them. It carries the queued count and since when.

On a Hub-coordinated host that does not own convergence, the candidate instruction names the owner host where the candidate is applied. The compact prompt includes capture upkeep in the cached health section; full applied owner rules remain in the instruction preamble.

## Cross-host knowledge convergence

[ADR-0466](../../../decisions/coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md) defines two item kinds; ADR-0468 adds a second publication item:

- `knowledge_convergence_owner` appears when this host's ownership verdict is `unverifiable` or `contended`. It carries the role, reason, Hub failure code and HTTP status when recorded, holder label, and observation time. Its instruction names the remediation for that failure code.
- `knowledge_publication` appears when the last publication of the owner's knowledge commits failed or was superseded by a conflict with the current base. It carries the failure code, path-free detail, pull request URL, occurrence count, and first observation. For a `gh` failure, detail is `gh <step> exit <code> <class>`, and the instruction names the remediation for the `auth`, `network`, `not_installed`, `not_mergeable`, or `not_found` class.
- A second `knowledge_publication` item, with failure code `knowledge_supersession_held`, appears when this checkout keeps superseded knowledge commits it could not drop ([ADR-0468](../../../decisions/coordination/sync/0468-propagate-knowledge-supersession-across-replicated-checkouts.md)). Detail gives the commit count and reason; the instruction names the remediation for that reason.

Ownership and publication recovery belong to the resident and knowledge publisher.
Structured `hub_forbidden` requires owner scope authority; `hub_unauthorized`
and `token_file_unreadable` require credential authority. Knowledge delegation
cannot grant those effects. Other failures do not establish owner authority. They are non-blocking; their source instructions remain inspectable. Each yields at most one item. The projection reads only the private fence, publication state, and supersession ledger; an unreadable file contributes no item.

[ADR-0469](../../../decisions/coordination/sync/0469-keep-background-knowledge-continuous-on-every-host.md) adds `knowledge_convergence_continuity`: one item per [continuity finding](../../../specs/background-knowledge-convergence/runtime/ownership-and-activation/continuity.md#findings) of severity `attention` or `owner_decision`, at most 16. Each carries the finding code, severity, a closed detail code or host label, and the last reconciliation time. Its instruction names the exact remediation. Only an `owner_decision` item has state `action_required` and requires user action. Owner-decision findings concern delegation or scope authority; other findings belong to the resident. All are non-blocking. The projection reads the delegation, host policy, fence, publication state, and continuity state without contacting the Hub.

## Coverage

`unavailable` coverage is not an empty success: aggregate status remains `action_required`, even when no item could be read. The background health path reports missing or unverifiable workstream state as
`unavailable`, without recovery, and records freshness/capture/convergence source
coverage separately. A missing workstream on the existing full inspection path
is reported as missing without inventing a blocker; a repository may legitimately have no current continuation.

## Privacy and failure meaning

The report may contain bounded workstream questions and approval summaries, repository-relative source paths, responsibility classes, candidate hashes, issue codes, and prescribed local commands. It excludes prompt bodies, provider output, credentials, native provider session IDs, absolute paths, and hidden reasoning.

Invalid or unsafe canonicalization state makes canonicalization coverage unavailable. Failed lifecycle inspection makes lifecycle coverage unavailable. Direct prompt retrieval remains available with degraded coverage visible. The explicit application command has the same read-only meaning and grants no resolution authority.
