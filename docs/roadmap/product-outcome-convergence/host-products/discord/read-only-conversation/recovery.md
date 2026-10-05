# Recovery, acceptance, and latency evidence

## Publication recovery

A live failure on 2026-09-08 established the recovery requirement: three mapped human messages reached Gateway intake and Claude intent resolution. Codex completed the latest response artifact, but an unstructured Claude writing-evaluation result blocked publication.

The repaired boundary requires provider structured output, reuses immutable intent evidence after restart, and advances autonomous durable-inbox retry only for the exact current integration, policy, and role.

External acceptance completed on 2026-09-08. The installed Node recovered all three unmentioned messages as delivered interactions. Discord published bot messages `1546786104592572439`, `1546786264756527214`, and `1546786478796046408`. The service subsequently reported `conversation.status: ready`, with no current-policy interaction pending. Historical records bound to an older policy remain retained and cannot enter the current retry worker.

## Restart recovery

A later live restart exposed a pre-inbox gap: messages `1546795654943219712` and `1546795695900729415` arrived around a Node process restart without platform correlations or interaction records. Gateway Resume state was process-local, so Discord did not replay them to the new identified session.

Restart recovery now reads after a durable per-channel platform cursor, re-enters the ordinary pipeline oldest-first, suppresses self replies, and withholds readiness on an unverified or over-bound gap.

## Concurrent attempts and latency

The observed `1546795085696471070` round trip took 56.9 seconds: intent resolution used 13.0 seconds and the first managed response used 14.5 seconds. A transient publication evaluator failure caused another response attempt before successful evaluation and delivery.

Later evidence showed that the 30-second inbox lease also expired during active provider work, allowing the retry worker to reclaim the same message concurrently and change the per-attempt digest. The repaired runtime renews the lease, uses a five-minute initial bound, excludes decision ID from the stable digest, and shares concurrent identical requests.

The installed latency profile omits the old sequential intent call and separate synchronous semantic evaluator while retaining managed Codex context, search evidence, token, cache, and stage telemetry.

The measured pre-change managed response baseline is 19.6–51.4 seconds across seven recent runs. Recovery acceptance proves delivery, not improved latency. Any response-speed claim requires a separate post-deployment sample. Establishing and enforcing a representative p95 from post-deployment human-authored turns remains required performance work. Simulated routing and retry tests do not establish conversational latency acceptance.
