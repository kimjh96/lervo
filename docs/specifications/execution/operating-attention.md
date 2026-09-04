# Operating attention

Status: `active`

As of: 2026-09-04

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

The projection includes pending workstream decisions and approvals, workstream blockers, nonterminal canonicalization candidates, and current knowledge-lifecycle issues. Candidate items expose outcome kind, proposed target paths, and whether proposed content exists, but never the summary or proposed Markdown body. Promoted and rejected candidates are terminal and excluded. Items are deduplicated by stable item ID, ordered with user-authority and blocking items first, and limited to 256 returned records. Explicit total and omitted counts prevent failure or an implication of complete coverage.

`unavailable` coverage is not an empty success and keeps aggregate status at `action_required`, even when no item could be read. A missing workstream is reported as missing but does not invent a blocker, because a repository may legitimately have no current continuation.

## Direct terminal context

Unmanaged Codex and Claude prompt preparation includes the report digest, counts, coverage, and at most twelve current items. It uses only the already verified current workstream, bounded canonicalization registry, and exact repository-lifecycle cache. It performs neither another model call nor a full lifecycle rescan on the prompt path.

The context directs the working agent to resolve in-scope, agent-owned maintenance and present a current blocking user question or approval in the same turn. It does not authorize approval, review, repository writes, or external effects. Repeating the current projection on later prompts proves preparation only; it does not prove delivery, acknowledgment, or user receipt.

## Privacy and failure meaning

The report may contain bounded workstream questions and approval summaries, repository-relative source paths, responsibility classes, candidate hashes, issue codes, and prescribed local commands. It excludes prompt bodies, provider output, credentials, native provider session IDs, absolute paths, and hidden reasoning.

Invalid or unsafe canonicalization state makes canonicalization coverage unavailable. Failed lifecycle inspection makes lifecycle coverage unavailable. Direct prompt retrieval remains available with degraded coverage visible. The explicit application command has the same read-only meaning and grants no resolution authority.

## Verification

Acceptance requires:

1. deterministic projection tests covering authority ordering, terminal-state exclusion, stable digests, and unavailable-source behavior;
2. direct-terminal integration proving that a newly created candidate appears on the next preparation;
3. application command tests for the JSON result; and
4. a packed external consumer that discovers protocol v2 and invokes the route without private workspace imports.

## References

- [ADR-0361](../../decisions/execution/applications/0361-project-operating-attention-without-new-authority.md)
- [Product-host protocol](product-host-protocol.md)
- [Repository knowledge lifecycle convergence](../../specs/repository-knowledge-lifecycle-convergence.md)
- [Product outcome convergence](../../roadmap/product-outcome-convergence.md)
