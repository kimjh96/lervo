# Slice 0 delivery notes

## Platform boundary ratchet (`wired`)

`pnpm architecture:check` runs `scripts/quality/check-platform-boundary.mjs` after the package-boundary check. The code-quality workflow runs it on every pull request and `main` push.

The scan covers non-test sources under `apps/*/src` and `packages/*/src`, with platform-specific exclusions:

- Discord: `packages/adapter-discord`, `packages/discord-gateway`, and `discord-*` files.
- Slack: `slack-*` files. ADR-0560 removed `packages/adapter-slack`, so any other Slack mention counts against the baseline.

`scripts/quality/platform-boundary-baseline.json` has one section per platform. It records each file's matching line count and, for `conversation-*` and `supervision-*` files, imported adapter modules. The first baseline recorded 325 Discord lines in 50 files and 18 Slack lines in 4 files.

The check fails if a count grows, a file outside the baseline mentions a platform, or a guarded file adds an adapter import. `pnpm architecture:baseline` only lowers counts and refuses to run while a leak exists. `scripts/quality/test/platform-boundary.test.mjs` injects leaks into a fixture tree, checks downward-only refresh, and keeps the tracked baseline current.

The label remains `wired` until a hosted-workflow CI run has failed on a real leak.

## Shared retry policy and error-fidelity lint (`wired`)

### Retry contract

`RetryPolicy` in `@lervo/execution-contract` has three fields:

- `maximumAttempts`: counter ceiling, from 1 to 100.
- `attentionAfter`: attempt after which automatic retry stops, from 1 to `maximumAttempts`.
- `backoff`: `initialDelayMs`, `multiplier` (1 to 10), and `maximumDelayMs`; delays are bounded to one day.

`admitRetryAttempt` refuses any counted attempt above `attentionAfter`. `decideRetryAfterFailure` schedules a capped exponential delay or returns `attention_required` with one of:

- `attempts_exhausted`.
- `attempt_ceiling_exceeded`: counter exceeds `maximumAttempts`, a contract violation.
- `non_retryable_failure`.

An invalid policy or counter fails with `invalid_retry_policy` before any attempt runs.

### Conversation outbound delivery

The outbound delivery cycle in `@lervo/interaction` expresses ADR-0424's existing bound through the shared contract: a fixed delay with three attempts by default. Healthy paths behave as before.

Each claimed lease is admitted before the adapter is called. A lease already above `attentionAfter` because earlier attempts were interrupted moves directly to `attention_required`, with failure code `delivery_attempts_exhausted` or `delivery_attempt_ceiling_exceeded`; the adapter is not called again. This addresses the loop that let one Tarin outbound reach 20,589 attempts.

Every cycle result carries `attention[]`: one `ConversationDeliveryAttention` per outbound leaving automatic delivery in that cycle. Required fields are `outboundId`, `integrationId`, `failureCode`, `reason`, `attemptCount`, `attentionAfter`, `owner` (`conversation_integration_operator`), and `recoveryCondition` (`verified_receipt_reconciliation`, the ADR-0424 path).

The record contains only identifiers and bounded codes, never message content, provider text, or credentials. It records no new canonical event. Because `attention_required` rows are never claimed again, an outbound appears in at most one cycle's `attention[]`.

If the store refuses the transition, the cycle throws and the lease expires. The next claim exceeds the bound and is refused again without delivery. The regression in `packages/interaction-sqlite/test/native-chat-runtime.test.ts` replays three interrupted claims followed by 20 more cycles, confirming that the adapter is never called and the stored counter remains 4.

Open work: publish an operator-surface notice from `attention[]`; apply the contract to replica cycles, knowledge jobs, and supervision dispatch.

### Error-fidelity lint

ESLint rule `lervo/require-caught-error-cause`, implemented in `scripts/quality/lib/eslint-error-cause-rule.mjs`, applies to `apps/*/src` and `packages/*/src`. It fails when:

- Code inside a catch clause throws a newly constructed `*Error` without passing the caught error, either as `cause` or directly.
- A catch clause discards its parameter.

`scripts/quality/test/eslint-error-cause-rule.test.mjs` covers valid and invalid forms. The 155 pre-existing findings are recorded per file in ESLint's bulk-suppression file, `eslint-suppressions.json`. ESLint owns this file, so Prettier skips it.

New findings fail `pnpm lint`. Stale suppressions also fail until removed by `eslint . --prune-suppressions`, so the baseline can only shrink. Adding entries with `--suppress-rule` requires a reviewed change naming the reason.

`code`, `stage`, and redacted `causeDigest` on wrapped failures remain open.
