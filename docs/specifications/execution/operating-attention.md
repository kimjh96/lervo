# Operating attention

Status: `active`

As of: 2026-10-05

## Purpose

Lervo projects current repository items requiring action into one provider-neutral, read-only report, exposing pending user authority, review work, and safe repository maintenance otherwise hidden in unrelated commands or incidental agent encounters.

The projection reads the current workstream, canonicalization candidate registry, and repository-knowledge lifecycle inspection. It is not another source of truth; existing ownership and mutation contracts remain authoritative.

## Report contract

`lervo application attention --json` returns an `OperatingAttentionReportV1` containing:

- Project and current workstream revision coordinates.
- A stable report digest excluding observation time.
- Explicit coverage for the workstream, canonicalization registry, and knowledge lifecycle.
- Bounded, typed items with action owner, user-authority requirement, blocking state, and next instruction.
- Counts for all, omitted, blocking, user-action, and stale items.

Items include pending workstream decisions and approvals, workstream blockers, nonterminal canonicalization candidates, and current knowledge-lifecycle issues. Workstream approvals and decisions carry a consequence class: `repository_write`, `deployment`, `external_effect`, or, for decisions, `unclassified`. Every class is consequential.

Items are deduplicated by stable item ID, ordered with user-authority and blocking items first, and capped at 256 returned records. Explicit total and omitted counts prevent failure or an implication of complete coverage.

### Workstream and candidates

Under [ADR-0462](../../decisions/execution/applications/0462-own-workstream-bookkeeping-and-stale-attention.md), a workstream snapshot is stale when:

- Its update time is older than 48 hours or in the future.
- Its recorded HEAD is more than 20 commits behind or is not an ancestor of current HEAD.

The optional `workstream` section of `.lervo/knowledge/policy.yaml` configures both thresholds. Every stale workstream item has `state: "stale"`, `blocking: false`, `requiresUserAction: false`, owner `agent`, and an instruction to re-verify against the repository rather than present it as current.

Candidate items expose outcome kind, proposed target paths, and whether proposed content exists, never the summary or proposed Markdown body. Promoted and rejected candidates are terminal and excluded.

### Document drift and freshness

Document drift warnings from `lervo knowledge lint` appear as knowledge-lifecycle items under [ADR-0464](../../decisions/knowledge/documents/0464-report-document-drift-and-historical-documents.md). At most four appear, plus one overflow item. Each is agent-owned, non-blocking, and requires no user action. Detail contains only relative paths and reason names. Drift warnings remain separate from lifecycle gates and never change terminal lifecycle status.

[ADR-0463](../../decisions/knowledge/documents/0463-refresh-stale-documents-with-evidence-bound-minimal-edits.md) defines three document freshness item kinds:

- `document_freshness_candidate`: a verified candidate awaiting its owner; user-owned, requires user action, and never blocking.
- `document_freshness_applied`: an informational, agent-owned apply notice naming the revert command; resolves on acknowledgement or after 24 hours.
- `document_freshness_blocked`: reports five attempts without a verified candidate in one day.

Freshness items carry candidate identifiers, relative paths, classes, and counts, never hunk text. The projection reads rebuildable freshness state in `lervo application attention` and on the cached retrieval prompt path. Unreadable state contributes no item. The compact prompt replaces these items with one freshness line of at most 200 bytes.

### Cross-host knowledge convergence

[ADR-0466](../../decisions/coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md) defines two item kinds:

- `knowledge_convergence_owner`: appears when this host's ownership verdict is `unverifiable` or `contended`; carries role, reason, holder label, and observation time.
- `knowledge_publication`: appears when the last publication of the owner's knowledge commits failed; carries failure code, path-free detail, pull request URL, occurrence count, and first observation.

Both are user-owned, require user action, and are never blocking. Each yields at most one item: the projection reads only the private fence and publication state, and an unreadable file contributes no item.

### Coverage

`unavailable` coverage is not an empty success: aggregate status remains `action_required` even when no item could be read. A missing workstream is reported as missing without inventing a blocker; a repository may legitimately have no current continuation.

## Direct terminal context

Unmanaged Codex and Claude prompt preparation includes the report digest, counts, coverage, and at most twelve current items. Stale workstream items appear only as a count with the `lervo workstream current` inspection command. Retrieval mode caps this section at 4 KiB; the whole compact context also has a hard 4 KiB budget. Truncation appends a deterministic marker.

Preparation uses only the already verified current workstream, its HEAD distance, the bounded canonicalization registry, and the exact repository-lifecycle cache. It makes no additional model call or full lifecycle rescan on the prompt path.

The context directs the working agent to resolve in-scope, agent-owned maintenance. It asks the agent to present a question or approval in the same turn only when the listed item is current, user-owned, blocking, and requires user action. Stale approvals and decisions are never directives; hook renderings withhold their text.

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
