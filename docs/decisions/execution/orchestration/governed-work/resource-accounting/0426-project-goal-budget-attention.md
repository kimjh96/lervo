# ADR-0426: Separate cumulative and per-attempt supervision budgets

- Status: accepted
- Decision date: 2026-09-22

## Context

Operating mandate versions 1 and 2 account resources across a workstream. A long-lived product
owner eventually reaches that cumulative ceiling even when the Node, conversation transport, and
repository are healthy. The runtime previously projected the failed admission as
`aggregate_budget_exceeded` under unavailable supervision, degrading the whole Node and exposing
neither the actual counters nor the distinction between consumed usage and a next reservation
that no longer fits.

Mandate version 3 binds aggregate accounting to one reviewed goal scope and gives each derived
successor goal an independent envelope. That still does not solve long-lived product workstreams:
AXLI's active launch objective accumulated ordinary repository conversations for days under one
goal. Raising its ceiling would only postpone the same permanent stop.

## Decision

Version 3 gains optional reviewed `aggregateTokenPolicy: { schemaVersion: 1, mode:
"per_attempt_only" }`. Under that policy, cumulative observed or reserved usage never blocks a new
effect and missing historical aggregate telemetry does not make resource admission unavailable.
`maximumAggregateTokens` remains in the version-3 wire shape for compatibility but has no
admission effect under this explicit policy.

The limit is not replaced with unlimited individual calls. `maximumAttemptTokens`, maximum
attempts per assignment, concurrent attempts, workers, assignments, deadlines, expiry, provider,
capability, role, and repository path scopes remain exact independent circuit breakers. This is the
appropriate policy for a long-lived repository product owner whose normal conversations share a
durable product workstream. Bounded short-lived goals may omit the policy and retain cumulative
admission.

Every deployed product owner uses V3 authority. Standing successor authority version 2 may still
pin a distinct bounded cumulative ceiling for later goals when the parent uses cumulative mode;
the per-attempt-only policy itself is inherited unchanged by derived mandates.

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

The Node remains operationally ready while this state is present. A cumulative supervised goal
starts no new effect until a reviewed mandate revision increases its envelope or the settled goal
advances through reviewed standing successor authority. Versions 1 and 2 retain the prior
unavailable projection because their counters are workstream-wide and must not be mislabeled as a
goal budget. Mandate succession within one running goal does not erase prior usage. A reviewed
per-attempt-only V3 mandate does not publish cumulative budget health because cumulative usage is
not an admission boundary.

## Privacy, failure, and verification

The projection contains no prompt, task body, provider output, price, credential, repository path,
agent ID, or workstream ID. It is replaceable health state, not a canonical event or completion
claim. Unknown usage remains `usage_unobserved`; other policy blocks and uncertain effects retain
their existing unavailable meanings.

Pure tests cover goal and legacy scope projection, per-attempt-only admission with unavailable or
already excessive cumulative usage, repository-wide path scope, exact remainder validation,
malformed health, aggregate readiness, and host readiness parsing. Installed acceptance requires
an exact reviewed product-owner mandate and a fresh observation; changing source code alone does
not alter installed authority.
