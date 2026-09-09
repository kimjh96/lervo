# Proactive signals and deliberation

An optional repository-event source maps allowlisted event types to existing `signal.raised` events without copying event payloads. Its owner-only cursor advances only after every mapped conversation dispatch completes. Participation, deterministic turn ownership, rate limits, managed retrieval, and publication remain unchanged.

Explicit deliberation commands enter the existing durable queue without a model classification round. The Node owns queue scheduling. An executable adapter invokes the existing managed CLI lifecycle with the assigned identity and stdin-only topic. Discord transport, queue persistence, process execution, and provider work remain separate dependencies.
