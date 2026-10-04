# Managed worker and Claude recovery facts

## Managed request target turns

On 2026-09-24, the uncertain-effect journal line identified Kael's next blocker as `contract_validation_failed`: the CLI's managed run never supplied `createTargetTurnId`. Every managed request with more than one expected path was rejected before any provider turn because each additional path requires its own target turn.

## Claude model identity

The first real Claude worker run failed with `provider_result_failed`. With the default Opus model, the Claude SDK keys result `modelUsage` by the context-window variant `claude-opus-5-5[1m]`, while assistant messages carry `claude-opus-5-5`. The bracketed ID violates the provider model-identity pattern, causing every Opus managed Claude turn result to fail schema validation. The Claude adapter now reads such a usage key as its base model ID.

## Claude login inspection

On 2026-09-25, Kael's owner turn failed readiness with "The owner reasoning native runtime or login is not ready."

The Claude OAuth access token lasts about eight hours; Claude Code refreshes it only on a real request. Once the stored access token lapsed, `auth status` gave no usable answer, preventing an idle owner from making the request that would refresh it.

Claude login inspection now treats an unanswered status probe as present when the stored login has a refresh token valid for more than ten minutes. It reads only that token's presence and expiry. An explicit logout or a missing executable still blocks.
