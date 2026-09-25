# ADR-0432: Enforce reserved tokens during managed turns

- Status: accepted
- Decision date: 2026-09-24

## Context

Resource usage of a managed provider run was recorded only after the run ended. On 2026-09-24, Kael's first real Claude worker attempt reserved 160,000 tokens and used 510,144 (389,298 cached input). The per-attempt mandate limit bounded admission but not execution. Claude reports authoritative turn usage only in its final result, so a turn could not be stopped before it had already overrun.

## Decision

- `ManagedProviderInteractionLimits` accepts an optional `maximumTotalTokens`. The limit uses the same measure as resource accounting: turn-cumulative total tokens, cached input included. The limiter keeps the largest value observed per provider turn and sums the turns. When the sum exceeds the limit, the run fails with `provider_token_limit_exceeded`. The provider turn is then stopped through the existing failure path, like the tool and command limits.
- A supervised managed run passes its effect's `reservedTokens` as `maximumTotalTokens`. Unsupervised runs are unchanged.
- A native owner dispatch reserves the mandate's reviewed `maximumAttemptTokens` for the worker. The owner reasoning reservation (`ownerReasoning.reservedTokens`) bounds only owner reasoning turns and never caps a worker. Admission still blocks a dispatch that exceeds the attempt or aggregate budget.
- The Claude adapter emits the new normalized event `provider.usage.estimated` (`providerTurnId`, `totalTokens`) after each assistant API message. The total counts every API message in the turn once, at its largest reported input, cache-read, cache-creation and output usage. The event is a lower bound for enforcement only. It is neither persisted nor accounting evidence. `provider.usage.updated` remains the only input to resource accounting, so an estimate can never regress the recorded counters. Codex already emits turn-cumulative `provider.usage.updated` during a turn.
- The estimate carries only counts and a provider turn ID, with no prompt, output or model text.

## Failure meaning

`provider_token_limit_exceeded` is non-retryable. It proves only that the observed tokens passed the reserved bound. It does not prove that the provider made no repository change: changes before the stop remain subject to the ordinary managed-write evidence and after-snapshot checks. Supervision therefore treats the attempt like any other failed attempt with possible effects.

## Consequences

A supervised attempt can no longer spend far beyond its reservation unnoticed. An owner must reserve what a task realistically needs: an agentic Opus turn that re-reads large context can use several hundred thousand total tokens, most of them cached. The mandate's per-attempt limit must allow that reservation.

## Verification

- Orchestrator: a run whose turn-cumulative usage reaches 1,001 against a 1,000 limit fails `provider_token_limit_exceeded` and stops the adapter; usage of exactly 1,000 completes.
- Claude normalizer: repeated content blocks of one API message count once at their largest usage, and distinct messages sum.
- Existing supervised managed-run suites pass with reservations applied.
- Native completion: every dispatched `work.managed_execution.v1` plan reserves the mandate's attempt budget, not the owner reservation. On 2026-09-25 Kael's documentation worker had been stopped with `provider_token_limit_exceeded` (150,173 tokens recorded) because dispatch had reused the 160,000 owner reservation instead of the 600,000 attempt budget.

## References

- [ADR-0013 managed write bridge](../0013-provider-neutral-managed-write-bridge.md)
- [ADR-0431 preflight and owner spend guard](../../orchestration/governed-work/owner-recovery/0431-fence-repeated-preflight-and-owner-spend.md)
