# Natural-language Discord conversation routing

Part of [Discord remote continuation](../discord.md).

State: `implemented`.

## Purpose

Mapped participants send ordinary messages in the configured Discord conversation, with or without a bot mention. A no-capability semantic adapter classifies each bounded turn as an informational answer, write-capable continuation, scoped Discord platform action, or clarification. Informational and unclear requests remain read-only. Only sufficiently confident human mutation requests reach an explicitly authorized effect.

## Design

Conversation participation, semantic intent resolution, read-only provider composition, Hub continuation, Discord administration, and platform delivery remain separate. The read-only role denies filesystem writes, shell execution, network access, external messages, deployment, and data mutation. Natural replies follow a multilingual chat contract and require managed context evidence. The realtime profile retains deterministic publication evidence without a second synchronous model; deployments may opt into independent semantic evaluation.

Participant bindings support humans and agents. Agent responses are opt-in and retain role identity, automation-depth limits, and hourly rate limits. The event boundary can later support managed deliberation without autonomous reply loops or agent-authored repository mutation.

## Validation

Focused tests prove:

- Ordinary messages with and without mentions enter the same semantic router.
- Bounded prior turns are supplied.
- Read and continuation delegates remain separate.
- Installed-runtime participation no longer requires a mention.
- Persisted response-generation failures are retried and delivered without another Discord message.
- Semantic publication evaluation supplies an exact structured-output schema through either provider adapter.
- Active inbox leases renew, identical response attempts share one generation, and typing remains active across scheduled retry.
- A natural-language nickname request uses the explicitly allowlisted current-member Discord action rather than repository continuation.
- Queue and completion prose hides internal execution coordinates while retaining them in durable evidence.

Gateway control traffic remains responsive during long provider work. Subsequent messages retain order. Response-only typing is bounded, best-effort, and continuous across a scheduled retry.

### Recovery and acceptance

A live failure on 2026-09-08 established the recovery requirement: three mapped human messages reached Gateway intake and Claude intent resolution. Codex completed the latest response artifact, but an unstructured Claude writing-evaluation result blocked publication. The repaired boundary requires provider structured output, reuses immutable intent evidence after restart, and advances autonomous durable-inbox retry only for the exact current integration, policy, and role.

External acceptance completed on 2026-09-08. The installed Node recovered all three unmentioned messages as delivered interactions. Discord published bot messages `1546786104592572439`, `1546786264756527214`, and `1546786478796046408`. The service subsequently reported `conversation.status: ready`, with no current-policy interaction pending. Historical records bound to an older policy remain retained and cannot enter the current retry worker.

A later live restart exposed a pre-inbox gap: messages `1546795654943219712` and `1546795695900729415` arrived around a Node process restart with neither platform correlations nor interaction records. Gateway Resume state was process-local, so Discord did not replay them to the new identified session. Restart recovery now reads after a durable per-channel platform cursor, re-enters the ordinary pipeline oldest-first, suppresses self replies, and withholds readiness on an unverified or over-bound gap.

The observed `1546795085696471070` round trip took 56.9 seconds: intent resolution used 13.0 seconds and the first managed response used 14.5 seconds. A transient publication evaluator failure caused another response attempt before successful evaluation and delivery. Later evidence showed that the 30-second inbox lease had also expired during active provider work, allowing the retry worker to reclaim the same message concurrently and change the per-attempt digest. The repaired runtime renews the lease, uses a five-minute initial bound, excludes decision ID from the stable digest, and shares concurrent identical requests.

The installed latency profile omits the separate synchronous semantic evaluator while retaining managed Codex context, evidence, token, and cache telemetry. Establishing and enforcing a representative p95 from post-deployment human-authored turns remains required performance work. Simulated routing and retry tests do not establish conversational latency acceptance.

## Configuration

The response path injects the exact current workstream so routine status questions need no provider-tool rediscovery. Intent, response, optional independent publication evaluation, and repository command execution have separate provider/model settings. Bounded reasoning effort is configurable for managed response and evaluation adapters. `administration.allowedActions` independently grants bounded Discord effects.

The measured pre-change managed response baseline is 19.6–51.4 seconds across seven recent runs. Recovery acceptance proves delivery, not improved latency. Any response-speed claim requires a separate post-deployment sample.

## References

- [ADR-0384](../../../../decisions/coordination/conversations/0384-explicit-discord-read-and-continuation-modes.md)
- [ADR-0388](../../../../decisions/coordination/conversations/0388-realtime-conversation-effects-and-lifecycle.md)
