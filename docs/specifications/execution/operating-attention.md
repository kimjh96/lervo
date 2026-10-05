# Operating attention

Status: `active`

As of: 2026-10-05

## Purpose

Lervo projects current repository items requiring action into one provider-neutral, read-only report. This prevents pending user authority, review work, and safe repository maintenance from remaining hidden in unrelated commands or appearing only when encountered incidentally by an agent.

The projection is not another source of truth. It reads the current workstream, canonicalization candidate registry, and repository-knowledge lifecycle inspection, whose existing ownership and mutation contracts remain authoritative.

## Report contract

`lervo application attention --json` returns an `OperatingAttentionReportV1` containing:

- project and current workstream revision coordinates;
- a stable report digest that excludes observation time;
- explicit coverage for the workstream, canonicalization registry, and knowledge lifecycle;
- bounded, typed items with action owner, user-authority requirement, blocking state, and next instruction; and
- counts for all, omitted, blocking, user-action, and stale items.

The projection includes pending workstream decisions and approvals, workstream blockers, nonterminal canonicalization candidates, and current knowledge-lifecycle issues. Workstream approvals and decisions carry a consequence class: `repository_write`, `deployment`, `external_effect`, or `unclassified` for decisions. Every class is consequential.

When the current workstream is stale under [ADR-0462](../../decisions/execution/applications/0462-own-workstream-bookkeeping-and-stale-attention.md), every workstream item has `state: "stale"`, `blocking: false`, `requiresUserAction: false`, owner `agent`, and an instruction to re-verify against the repository instead of presenting the item as current. A snapshot is stale when its update time is older than 48 hours, its recorded HEAD is more than 20 commits behind or not an ancestor of the current HEAD, or its update time is in the future. The optional `workstream` section of `.lervo/knowledge/policy.yaml` configures both thresholds. Candidate items expose outcome kind, proposed target paths, and whether proposed content exists, but never the summary or proposed Markdown body. Promoted and rejected candidates are terminal and excluded. Items are deduplicated by stable item ID, ordered with user-authority and blocking items first, and limited to 256 returned records. Explicit total and omitted counts prevent failure or an implication of complete coverage.

Document drift warnings from `lervo knowledge lint` appear as knowledge-lifecycle items, as defined in [ADR-0464](../../decisions/knowledge/documents/0464-report-document-drift-and-historical-documents.md). There are at most four, plus one overflow item. Each is agent-owned, non-blocking, and does not require user action. Their detail holds only relative paths and reason names. They are kept separate from lifecycle gates, so they never change terminal lifecycle status.

Document freshness adds three item kinds, as defined in [ADR-0463](../../decisions/knowledge/documents/0463-refresh-stale-documents-with-evidence-bound-minimal-edits.md). `document_freshness_candidate` is a verified candidate that waits for the owner; it is user-owned, requires user action, and is never blocking. `document_freshness_applied` is an informational, agent-owned notice of an apply that names the revert command and resolves on acknowledgement or after 24 hours. `document_freshness_blocked` reports five attempts with no verified candidate in one day. The items carry candidate identifiers, relative paths, classes, and counts, never hunk text. The projection reads them from the rebuildable freshness state in `lervo application attention` and on the cached retrieval prompt path; an unreadable state contributes no item. The compact prompt shows one freshness line of at most 200 bytes instead of the items.

Owner-turn capture adds two item kinds, as defined in [ADR-0467](../../decisions/knowledge/documents/0467-capture-owner-turns-semantically-in-the-knowledge-resident.md). `durable_instruction_candidate` is an exact-review instruction candidate with its source (`terminal_prompt`, `conversation`, or `explicit_intake`), normalized title, target path, and hash-bound review command. `captured_decision` is a held owner decision or a rule that needs the owner's confirmation, with a dismiss command. Both are user-owned, require user action, and are never blocking. They carry normalized titles, never owner or agent turn text. A third kind, `instruction_capture_blocked`, appears once per host while owner turns are queued but the host has no delegation to assess them; it carries the queued count and since when. On a Hub-coordinated host that does not own convergence, the candidate instruction names the owner host where the candidate is applied. The compact prompt shows one capture line and one applied-owner-rule line, each at most 600 bytes, instead of the items.

Cross-host knowledge convergence adds two item kinds, as defined in [ADR-0466](../../decisions/coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md). `knowledge_convergence_owner` appears when this host's ownership verdict is `unverifiable` or `contended`. It carries the role, reason, Hub failure code and HTTP status when recorded, holder label, and observation time, and its instruction names the remediation for that failure code. `knowledge_publication` appears when the last publication of the owner's knowledge commits failed or was superseded by a conflict with the current base. It carries the failure code, a path-free detail, the pull request URL, the occurrence count, and the first observation. Both are user-owned, require user action, and are never blocking. Each yields at most one item, because the projection reads only the private fence and the publication state; an unreadable file contributes no item.

`unavailable` coverage is not an empty success and keeps aggregate status at `action_required`, even when no item could be read. A missing workstream is reported as missing but does not invent a blocker, because a repository may legitimately have no current continuation.

## Direct terminal context

Unmanaged Codex and Claude prompt preparation includes the report digest, counts, coverage, and at most twelve current items. Stale workstream items are excluded and reported only as a count with the `lervo workstream current` inspection command. Retrieval mode caps this section at 4 KiB, and the whole compact context has a hard 4 KiB budget. Truncation appends a deterministic marker. Preparation uses only the already verified current workstream, its HEAD distance, the bounded canonicalization registry, and the exact repository-lifecycle cache. It performs neither another model call nor a full lifecycle rescan on the prompt path.

The context directs the working agent to resolve in-scope, agent-owned maintenance. Only when a listed item is current, user-owned, blocking, and requires user action does it ask the agent to present that question or approval in the same turn. A stale approval or decision is never a directive, and hook renderings withhold its text. The context does not authorize approval, review, repository writes, or external effects. Repeating the current projection on later prompts proves preparation only; it does not prove delivery, acknowledgment, or user receipt.

## Privacy and failure meaning

The report may contain bounded workstream questions and approval summaries, repository-relative source paths, responsibility classes, candidate hashes, issue codes, and prescribed local commands. It excludes prompt bodies, provider output, credentials, native provider session IDs, absolute paths, and hidden reasoning.

Invalid or unsafe canonicalization state makes canonicalization coverage unavailable. Failed lifecycle inspection makes lifecycle coverage unavailable. Direct prompt retrieval remains available with degraded coverage visible. The explicit application command has the same read-only meaning and grants no resolution authority.

## Verification

Acceptance requires:

1. deterministic projection tests covering authority ordering, terminal-state exclusion, stable digests, unavailable-source behavior, stale workstream items, and context byte caps;
2. direct-terminal integration proving that a newly created candidate appears on the next preparation;
3. application command tests for the JSON result; and
4. a packed external consumer that discovers protocol v2 and invokes the route without private workspace imports.

## References

- [ADR-0361](../../decisions/execution/applications/0361-project-operating-attention-without-new-authority.md)
- [ADR-0462](../../decisions/execution/applications/0462-own-workstream-bookkeeping-and-stale-attention.md)
- [ADR-0464](../../decisions/knowledge/documents/0464-report-document-drift-and-historical-documents.md)
- [ADR-0463](../../decisions/knowledge/documents/0463-refresh-stale-documents-with-evidence-bound-minimal-edits.md)
- [Product-host protocol](product-host-protocol.md)
- [Repository knowledge lifecycle convergence](../../specs/repository-knowledge-lifecycle-convergence.md)
- [Product outcome convergence](../../roadmap/product-outcome-convergence.md)
