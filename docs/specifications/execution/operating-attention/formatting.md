# Operating attention formatting

This reference describes `apps/cli/src/operating-attention-format.ts`. Read it with [replica receipt inspection and projection](replica-receipts.md). The formatter consumes an existing report; it does not inspect repository state or prove that a terminal caller supplies any particular item.

## Explicit report text

`formatOperatingAttention` prints status, report digest, aggregate total, omitted, blocking, user-action, and stale counts, followed by workstream, canonicalization, and knowledge-lifecycle coverage. It formats every supplied item with kind, ID, owner, description, and instruction, then prints each limitation and a trailing newline.

Descriptions depend on item kind:

- Workstream decisions use the question; approvals and blockers use the summary.
- Canonicalization reviews show state, source count, outcome kind with a `legacy_metadata_only` fallback, and proposed targets or recommended roots.
- Replica divergence shows replica ID, reason, conflict count, and any supplied conflict paths.
- Freshness candidates show state, document path, priority, change classes, and hunk count.
- Applied freshness shows state, document path, approval source, and the first twelve commit-hash characters when present.
- Blocked freshness shows reason code and attempt count.
- Remaining lifecycle descriptions show issue code and non-null detail.

These values are formatted from the report. The formatter establishes no additional validation or redaction of their contents.

## Terminal context selection

`isStaleWorkstreamItem` recognizes only workstream decision, approval, and blocker items whose state is `stale`. Terminal formatting excludes those items and reports their count with a direction to run `lervo workstream current`. This count covers supplied report items, not items already omitted by the report producer. Stale items of other kinds are not removed by this predicate.

The formatter preserves report order and selects at most twelve remaining items. It prints each selected item's kind, ID, owner, user-action flag, blocking flag, and description. Unlike explicit report output, these rows omit the item's instruction. If additional non-filtered items remain, it prints their count and points to `lervo application attention --json`.

The header retains the original report's status, digest, aggregate counts, canonicalization coverage, and lifecycle coverage. Those counts are not recalculated for the twelve-item selection. Report-level omitted counts and the additional-items line describe different truncation stages.

A same-turn user-question or approval directive is added only if a selected item has owner `user`, requires user action, and is blocking. The predicate does not separately test state beyond the earlier stale-workstream filtering. An otherwise qualifying item outside the selection does not trigger the directive.

The assembled text always directs the agent to resolve current agent-owned items within task scope before claiming completion. It also prohibits inferring approval, asking the user to perform bookkeeping, or treating the projection as a receipt or acknowledgment.

Finally, `capContextBytes` receives the assembled section and `MAXIMUM_TERMINAL_ATTENTION_BYTES`. This source does not reveal the constant's numeric value or the helper's truncation algorithm, so it does not prove every assembled line survives the cap. Formatting establishes neither terminal invocation nor successful presentation, acknowledgment, authorization, or resolution.
