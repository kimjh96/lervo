# ADR-0426: Project goal budget exhaustion as operational attention

- Status: accepted
- Decision date: 2026-09-22

## Context

Operating mandate versions 1 and 2 account resources across a workstream. A long-lived product
owner eventually reaches that cumulative ceiling even when the Node, conversation transport, and
repository are healthy. The runtime previously projected the failed admission as
`aggregate_budget_exceeded` under unavailable supervision, degrading the whole Node and exposing
neither the actual counters nor the distinction between consumed usage and a next reservation
that no longer fits.

Mandate version 3 already binds aggregate accounting to one reviewed goal scope and gives each
derived successor goal an independent envelope. The remaining defect was installed V2 authority
and a health projection that treated a bounded policy stop like a service failure.

## Decision

Keep an aggregate safety ceiling. It remains necessary to stop unbounded autonomous retries,
delegation, and provider calls before an effect. Use V3 `workScope` for every deployed product
owner, so `maximumAggregateTokens` means the current goal rather than the product owner's
lifetime. Standing successor authority version 2 pins a separate ceiling for later goals, allowing
one reviewed running-goal renewal without propagating that exceptional increase.

When exact observed and reserved usage is available and the next reservation does not fit a V3
goal, supervision health becomes:

- `status: attention`;
- `reasonCode: goal_budget_insufficient`; and
- required `resourceBudget` fields `schemaVersion`, `scope`, `limitTokens`, `observedTokens`,
  `reservedTokens`, `requestedTokens`, and `remainingTokens`.

`scope` is exactly `goal`. Every numeric field is a nonnegative safe integer, and
`remainingTokens` equals the nonnegative remainder before the requested reservation. These are
provider-reported or exact reservation token units, not price, billing balance, context window, or
vendor quota.

The Node remains operationally ready while this state is present. The supervised goal starts no
new effect until a reviewed mandate revision increases its envelope or the settled goal advances
through reviewed standing successor authority. Versions 1 and 2 retain the prior unavailable
projection because their counters are workstream-wide and must not be mislabeled as a goal budget.
Mandate succession within one running goal does not erase prior usage.

## Privacy, failure, and verification

The projection contains no prompt, task body, provider output, price, credential, repository path,
agent ID, or workstream ID. It is replaceable health state, not a canonical event or completion
claim. Unknown usage remains `usage_unobserved`; other policy blocks and uncertain effects retain
their existing unavailable meanings.

Pure tests cover goal and legacy scope projection, exact remainder validation, malformed health,
aggregate readiness, and host readiness parsing. Installed acceptance requires a V3 product-owner
mandate and a fresh observation; changing source code alone does not clear an existing V2 budget
block.
