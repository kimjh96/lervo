# Operating attention

Status: `active`

As of: 2026-10-05

## Purpose

Lervo projects current repository items requiring action into one provider-neutral, read-only report, exposing pending user authority, review work, and safe repository maintenance otherwise hidden across commands or encountered incidentally by an agent.

The projection is not a source of truth. It reads the current workstream, canonicalization candidate registry, and repository-knowledge lifecycle inspection; their existing ownership and mutation contracts remain authoritative.

## Report contract

`lervo application attention --json` returns an `OperatingAttentionReportV1` containing:

- project and current workstream revision coordinates;
- a stable report digest excluding observation time;
- explicit workstream, canonicalization-registry, and knowledge-lifecycle coverage;
- bounded, typed items with action owner, user-authority requirement, blocking state, and next instruction; and
- all, omitted, blocking, user-action, and stale item counts.

The projection includes pending workstream decisions and approvals, workstream blockers, nonterminal canonicalization candidates, and current knowledge-lifecycle issues. Workstream approvals and decisions carry a consequence class: `repository_write`, `deployment`, `external_effect`, or, for decisions, `unclassified`. Every class is consequential.

Items are deduplicated by stable item ID, ordered with user-authority and blocking items first, and limited to 256 returned records. Explicit total and omitted counts prevent failure or an implication of complete coverage.

### Workstream and canonicalization candidates

Under [ADR-0462](../../decisions/execution/applications/0462-own-workstream-bookkeeping-and-stale-attention.md), a workstream snapshot is stale when:

- its update time is older than 48 hours;
- its recorded HEAD is more than 20 commits behind or is not an ancestor of the current HEAD; or
- its update time is in the future.

The optional `workstream` section of `.lervo/knowledge/policy.yaml` configures both thresholds. Every item from a stale workstream has `state: "stale"`, `blocking: false`, `requiresUserAction: false`, owner `agent`, and an instruction to re-verify against the repository instead of presenting it as current.

Candidate items expose outcome kind, proposed target paths, and whether proposed content exists, never the summary or proposed Markdown body. Promoted and rejected candidates are terminal and excluded.

### Document drift

Document drift warnings from `lervo knowledge lint` appear as knowledge-lifecycle items under [ADR-0464](../../decisions/knowledge/documents/0464-report-document-drift-and-historical-documents.md). At most four appear, plus one overflow item. Each is agent-owned, non-blocking, and requires no user action. Detail contains only relative paths and reason names. Drift warnings remain separate from lifecycle gates and never change terminal lifecycle status.

### Document freshness

[ADR-0463](../../decisions/knowledge/documents/0463-refresh-stale-documents-with-evidence-bound-minimal-edits.md) defines three item kinds:

- `document_freshness_candidate`: a verified candidate waiting for the owner; user-owned, requiring user action, and never blocking.
- `document_freshness_applied`: an informational, agent-owned apply notice naming the revert command; resolves on acknowledgement or after 24 hours.
- `document_freshness_blocked`: reports five attempts with no verified candidate in one day.

These items carry candidate identifiers, relative paths, classes, and counts, never hunk text. The projection reads rebuildable freshness state in `lervo application attention` and on the cached retrieval prompt path. Unreadable state contributes no item. The compact prompt substitutes one freshness line of at most 200 bytes for the items.

### Owner-turn capture

[ADR-0467](../../decisions/knowledge/documents/0467-capture-owner-turns-semantically-in-the-knowledge-resident.md) defines:

- `durable_instruction_candidate`: an exact-review instruction candidate carrying its source (`terminal_prompt`, `conversation`, or `explicit_intake`), normalized title, target path, and hash-bound review command.
- `captured_decision`: a held owner decision or rule needing the owner's confirmation, with a dismiss command.

Both are user-owned, require user action, and are never blocking. They carry normalized titles, never owner or agent turn text.

A third kind, `instruction_capture_blocked`, appears once per host while owner turns are queued but the host lacks delegation to assess them. It carries the queued count and since when.

On a Hub-coordinated host that does not own convergence, the candidate instruction names the owner host where the candidate is applied. The compact prompt substitutes one capture line and one applied-owner-rule line, each at most 600 bytes, for the items.

### Cross-host knowledge convergence

[ADR-0466](../../decisions/coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md) defines two item kinds:

- `knowledge_convergence_owner` appears when this host's ownership verdict is `unverifiable` or `contended`. It carries the role, reason, Hub failure code and HTTP status when recorded, holder label, and observation time. Its instruction names the remediation for that failure code.
- `knowledge_publication` appears when the last publication of the owner's knowledge commits failed or was superseded by a conflict with the current base. It carries the failure code, path-free detail, pull request URL, occurrence count, and first observation. For a `gh` failure the detail is `gh <step> exit <code> <class>`, and the instruction names the remediation for the `auth`, `network`, `not_installed`, `not_mergeable`, or `not_found` class.
- A second `knowledge_publication` item, with failure code `knowledge_supersession_held`, appears when this checkout keeps superseded knowledge commits it could not drop ([ADR-0468](../../decisions/coordination/sync/0468-propagate-knowledge-supersession-across-replicated-checkouts.md)). Its detail gives the commit count and reason, and its instruction names the remediation for that reason.

All are user-owned, require user action, and are never blocking. Each yields at most one item: the projection reads only the private fence, publication state, and supersession ledger, and an unreadable file contributes no item.

### Coverage

`unavailable` coverage is not an empty success: aggregate status remains `action_required`, even when no item could be read. A missing workstream is reported as missing without inventing a blocker; a repository may legitimately have no current continuation.

## Direct terminal context

Unmanaged Codex and Claude prompt preparation includes the report digest, counts, coverage, and at most twelve current items. Stale workstream items are excluded and represented only by a count with the `lervo workstream current` inspection command.

Retrieval mode caps this section at 4 KiB; the whole compact context also has a hard 4 KiB budget. Truncation appends a deterministic marker. Preparation uses only the already verified current workstream, its HEAD distance, the bounded canonicalization registry, and the exact repository-lifecycle cache. It performs neither another model call nor a full lifecycle rescan on the prompt path.

The context directs the working agent to resolve in-scope, agent-owned maintenance. It asks the agent to present a question or approval in the same turn only when the listed item is current, user-owned, blocking, and requires user action. A stale approval or decision is never a directive, and hook renderings withhold its text.

The context authorizes no approval, review, repository writes, or external effects. Repeating the current projection on later prompts proves preparation only, not delivery, acknowledgment, or user receipt.

## Privacy and failure meaning

The report may contain bounded workstream questions and approval summaries, repository-relative source paths, responsibility classes, candidate hashes, issue codes, and prescribed local commands. It excludes prompt bodies, provider output, credentials, native provider session IDs, absolute paths, and hidden reasoning.

Invalid or unsafe canonicalization state makes canonicalization coverage unavailable. Failed lifecycle inspection makes lifecycle coverage unavailable. Direct prompt retrieval remains available with degraded coverage visible. The explicit application command has the same read-only meaning and grants no resolution authority.

## Verification

Acceptance requires:

1. Deterministic projection tests covering authority ordering, terminal-state exclusion, stable digests, unavailable-source behavior, stale workstream items, and context byte caps.
2. Direct-terminal integration proving a newly created candidate appears on the next preparation.
3. Application command tests for the JSON result.
4. A packed external consumer that discovers protocol v2 and invokes the route without private workspace imports.

## References

- [ADR-0361](../../decisions/execution/applications/0361-project-operating-attention-without-new-authority.md)
- [ADR-0462](../../decisions/execution/applications/0462-own-workstream-bookkeeping-and-stale-attention.md)
- [ADR-0464](../../decisions/knowledge/documents/0464-report-document-drift-and-historical-documents.md)
- [ADR-0463](../../decisions/knowledge/documents/0463-refresh-stale-documents-with-evidence-bound-minimal-edits.md)
- [Product-host protocol](product-host-protocol.md)
- [Repository knowledge lifecycle convergence](../../specs/repository-knowledge-lifecycle-convergence.md)
- [Product outcome convergence](../../roadmap/product-outcome-convergence.md)
