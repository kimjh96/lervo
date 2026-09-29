# ADR-0432: Enforce reserved tokens during managed turns

- Status: accepted
- Decision date: 2026-09-24

## Context

Managed provider usage was recorded only after a run ended. On 2026-09-24, Kael's first real Claude worker attempt reserved 160,000 tokens but used 510,144, including 389,298 cached input tokens. The mandate's per-attempt limit bounded admission, not execution. Claude reports authoritative turn usage only in its final result, preventing a stop before an overrun had occurred.

## Decision

- `ManagedProviderInteractionLimits` accepts optional `maximumTotalTokens`. Initially, this used the resource-accounting measure: turn-cumulative total tokens, including cached input. The limiter keeps the largest observed value per provider turn and sums turns. A sum exceeding the limit fails the run with `provider_token_limit_exceeded` and stops the provider turn through the existing failure path used for tool and command limits. The amendment below changes the budget measure.
- A supervised managed run passes its effect's `reservedTokens` as `maximumTotalTokens`. Unsupervised runs are unchanged.
- Native owner dispatch reserves the mandate's reviewed `maximumAttemptTokens` for the worker. `ownerReasoning.reservedTokens` bounds only owner reasoning turns and never caps a worker. Admission still blocks dispatch exceeding the attempt or aggregate budget.
- After each assistant API message, the Claude adapter emits normalized `provider.usage.estimated` with `providerTurnId` and `totalTokens`. The total counts each API message in the turn once, at its largest reported input, cache-read, cache-creation and output usage. This lower bound is for enforcement only: it is neither persisted nor accounting evidence. Only `provider.usage.updated` feeds resource accounting, so estimates cannot regress recorded counters. Codex already emits turn-cumulative `provider.usage.updated` during a turn.
- Estimates contain only counts and a provider turn ID, with no prompt, output or model text.

## Failure meaning

`provider_token_limit_exceeded` is non-retryable. It proves only that observed tokens exceeded the reserved bound, not that the provider made no repository change. Changes made before the stop remain subject to ordinary managed-write evidence and after-snapshot checks. Supervision treats the attempt as a failed attempt with possible effects.

## Consequences

Supervised attempts can no longer spend far beyond their reservations unnoticed. Owners must reserve realistic task budgets: an agentic Opus turn re-reading large context can use several hundred thousand total tokens, mostly cached. The mandate's per-attempt limit must permit the reservation.

## Verification

- Orchestrator: turn-cumulative usage of 1,001 against a 1,000 limit fails with `provider_token_limit_exceeded` and stops the adapter; exactly 1,000 completes.
- Claude normalizer: repeated content blocks from one API message count once at their largest usage; distinct messages sum.
- Existing supervised managed-run suites pass with reservations applied.
- Native completion: every dispatched `work.managed_execution.v1` plan reserves the mandate's attempt budget, not the owner reservation. On 2026-09-25, Kael's documentation worker was stopped with `provider_token_limit_exceeded`, with 150,173 tokens recorded, because dispatch reused the 160,000 owner reservation instead of the 600,000 attempt budget.

## References

- [ADR-0013 managed write bridge](../0013-provider-neutral-managed-write-bridge.md)
- [ADR-0431 preflight and owner spend guard](../../orchestration/governed-work/owner-recovery/0431-fence-repeated-preflight-and-owner-spend.md)

## Amendment 2026-09-25: cost-equivalent budget tokens

Every provider turn re-reads the whole cached context. A Kael worker exhausted its 600,000-token reservation in 90 seconds across three turns, mostly through cached re-reads: 317,135 of the 424,506 tokens recorded before the stop were cached.

Budget enforcement now charges cached input reads at one tenth of a token, matching their relative price, using `budgetTokens` in `@lervo/execution-contract`. This applies to:

- The running turn limit.
- The aggregate task budget.
- The owner spend allowance.

`resource.usage.recorded` counters retain raw provider values. Cache writes and uncached input still count in full.
