# Natural-language Discord conversation routing

Part of [Discord remote continuation](../discord.md).

State: `implemented`.

## Purpose

Mapped participants send ordinary messages in the configured Discord conversation, with or without a bot mention. A no-capability semantic adapter classifies each bounded turn as an informational answer, write-capable continuation, or clarification. Informational and unclear requests remain read-only. Only sufficiently confident human mutation requests reach the signed exact-workstream continuation path.

## Design

The implementation separates conversation participation, semantic intent resolution, read-only provider composition, Hub continuation, and platform delivery. The read-only role denies filesystem writes, shell execution, network access, external messages, deployment, and data mutation. Natural replies follow a multilingual chat contract and require managed context evidence and independent publication evaluation.

Participant bindings support humans and agents. Agent responses are opt-in and retain role identity, automation-depth limits, and hourly rate limits. This lets the same event boundary later support managed deliberation without autonomous reply loops or agent-authored repository mutation.

## Validation

Focused tests prove:

- Ordinary messages with and without mentions enter the same semantic router.
- Bounded prior turns are supplied.
- Read and continuation delegates remain separate.
- Installed-runtime participation no longer requires a mention.
- Persisted response-generation failures are retried and delivered without another Discord message.
- Semantic publication evaluation supplies an exact structured-output schema through either provider adapter.

Gateway control traffic remains responsive during long provider work. Subsequent messages retain order; response-only typing activity is bounded and best-effort.

### Recovery and acceptance

A live failure on 2026-09-08 established the recovery requirement: three mapped human messages reached Gateway intake and Claude intent resolution. Codex completed the latest response artifact, but an unstructured Claude writing-evaluation result blocked publication. The repaired boundary requires provider structured output, reuses immutable intent evidence after restart, and advances autonomous durable-inbox retry only for the exact current integration, policy, and role.

External acceptance completed on 2026-09-08. The installed Node recovered all three unmentioned messages as delivered interactions. Discord published bot messages `1546786104592572439`, `1546786264756527214`, and `1546786478796046408`. The service subsequently reported `conversation.status: ready`, with no current-policy interaction pending. Historical records bound to an older policy remain retained and cannot enter the current retry worker.

## Configuration

The response path injects the exact current workstream so routine status questions do not need to rediscover it with provider tools. Intent, response, and independent publication evaluation have separate provider/model settings. Bounded reasoning effort is configurable for managed response and evaluation adapters.

The measured pre-change managed response baseline is 19.6–51.4 seconds across seven recent runs. Recovery acceptance proves delivery, not improved latency. Any response-speed claim requires a separate post-deployment sample.

## References

- [ADR-0384](../../../../decisions/coordination/conversations/0384-explicit-discord-read-and-continuation-modes.md)
