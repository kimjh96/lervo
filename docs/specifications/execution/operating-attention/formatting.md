# Operating attention formatting

This reference describes `apps/cli/src/operating-attention-format.ts`. Read it with [replica receipt inspection and projection](replica-receipts.md). The formatter consumes an existing report; it neither inspects repository state nor proves that a terminal caller supplies any particular item.

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

Values come from the report; formatting establishes no additional validation or redaction.

## Terminal context selection

`isStaleWorkstreamItem` recognizes only workstream decision, approval, and blocker items whose state is `stale`. Terminal formatting excludes these items and reports their count with a direction to run `lervo workstream current`. The count covers supplied report items, not items already omitted by the report producer. The predicate does not remove stale items of other kinds.

The formatter preserves report order and selects at most twelve remaining items. Each selected row includes kind, ID, owner, user-action flag, blocking flag, and description, but omits the instruction included in explicit report output. If additional non-filtered items remain, it prints their count and points to `lervo application attention --json`.

The header retains the original report's status, digest, aggregate counts, canonicalization coverage, and lifecycle coverage. Counts are not recalculated for the twelve-item selection. Report-level omitted counts and the additional-items line describe different truncation stages.

A same-turn user-question or approval directive is added only if a selected item has owner `user`, requires user action, and is blocking. Beyond the earlier stale-workstream filtering, this predicate does not separately test state. A qualifying item outside the selection does not trigger the directive.

The assembled text always directs the agent to resolve current agent-owned items within task scope before claiming completion. It prohibits inferring approval, asking the user to perform bookkeeping, or treating the projection as a receipt or acknowledgment.

Finally, `capContextBytes` receives the assembled section and `MAXIMUM_TERMINAL_ATTENTION_BYTES`. This source reveals neither the constant's numeric value nor the helper's truncation algorithm, so it does not prove that every assembled line survives the cap. Formatting establishes neither terminal invocation nor successful presentation, acknowledgment, authorization, or resolution.
