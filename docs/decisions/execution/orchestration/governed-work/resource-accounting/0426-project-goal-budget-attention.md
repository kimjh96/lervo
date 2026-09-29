# ADR-0426: Separate cumulative and per-attempt supervision budgets

- Status: accepted
- Decision date: 2026-09-22

## Context

Operating mandate versions 1 and 2 account resources across a workstream. Long-lived product owners eventually reach that cumulative ceiling even when the Node, conversation transport, and repository are healthy. The runtime previously projected failed admission as `aggregate_budget_exceeded` under unavailable supervision, degrading the whole Node without exposing counters or distinguishing consumed usage from a next reservation that no longer fits.

Version 3 binds aggregate accounting to one reviewed goal scope and gives each derived successor goal an independent envelope. This still cannot sustain long-lived product workstreams: AXLI's active launch objective accumulated ordinary repository conversations for days under one goal. Raising its ceiling would only postpone the same permanent stop.

## Decision

Version 3 gains optional reviewed `aggregateTokenPolicy: { schemaVersion: 1, mode: "per_attempt_only" }`. Under this policy:

- Cumulative observed or reserved usage never blocks a new effect.
- Missing historical aggregate telemetry does not make resource admission unavailable.
- `maximumAggregateTokens` remains in the version-3 wire shape for compatibility but has no admission effect.

Individual calls remain bounded. `maximumAttemptTokens`, maximum attempts per assignment, concurrent attempts, workers, assignments, deadlines, expiry, provider, capability, role, and repository path scopes remain exact independent circuit breakers.

This policy suits long-lived repository product owners whose normal conversations share a durable product workstream. Bounded short-lived goals may omit it and retain cumulative admission.

Every deployed product owner uses V3 authority. Standing successor authority version 2 may still pin a distinct bounded cumulative ceiling for later goals when the parent uses cumulative mode. Derived mandates inherit the per-attempt-only policy unchanged.

### Cumulative goal budget health

When exact observed and reserved usage is available and the next reservation does not fit a V3 goal, supervision health becomes:

- `status: attention`;
- `reasonCode: goal_budget_insufficient`;
- required `resourceBudget` fields: `schemaVersion`, `scope`, `limitTokens`, `observedTokens`, `reservedTokens`, `requestedTokens`, and `remainingTokens`.

`scope` is exactly `goal`. Every numeric field is a nonnegative safe integer. `remainingTokens` equals the nonnegative remainder before the requested reservation. Token units are provider-reported or exact reservation units, not price, billing balance, context window, or vendor quota.

The Node remains operationally ready in this state. A cumulative supervised goal starts no new effect until a reviewed mandate revision increases its envelope or the settled goal advances through reviewed standing successor authority. Mandate succession within one running goal does not erase prior usage.

Versions 1 and 2 retain the prior unavailable projection: their workstream-wide counters must not be mislabeled as a goal budget. A reviewed per-attempt-only V3 mandate does not publish cumulative budget health because cumulative usage is not an admission boundary.

## Privacy, failure, and verification

The projection excludes prompt, task body, provider output, price, credential, repository path, agent ID, and workstream ID. It is replaceable health state, not a canonical event or completion claim. Unknown usage remains `usage_unobserved`; other policy blocks and uncertain effects retain their existing unavailable meanings.

Pure tests cover:

- Goal and legacy scope projection.
- Per-attempt-only admission with unavailable or already excessive cumulative usage.
- Repository-wide path scope.
- Exact remainder validation.
- Malformed health.
- Aggregate readiness.
- Host readiness parsing.

Installed acceptance requires an exact reviewed product-owner mandate and a fresh observation. Changing source code alone does not alter installed authority.
