# Example behavior

## Intent and routing

- Every ordinary message from the mapped human in the mapped channel enters the conversation; bot mentions are optional.
- One read-only Codex managed turn resolves intent, the exact hired agent's role-relevant participation, a bounded effect, and any informational reply.
- Unaddressed peer turns may remain silent without another model call.
- The turn receives the exact workstream and qualified search, repository-knowledge, and relation recommendations.
- Clear repository change or continuation intent queues the command's Claude exact-workstream path.
- An allowed request to change this bot's guild nickname calls the scoped Discord current-member adapter and verifies the returned application identity and nickname. It does not queue repository work.
- Ambiguity remains read-only: clarification changes neither repository nor external state.

## Execution and continuity

- Omitting `routing.evaluation` selects the deterministic realtime chat contract and avoids a second synchronous model call. An evaluation object enables a separate schema-constrained semantic pass without changing response provider identity.
- Each selected provider and configured model is retained at its own execution boundary. A hired bot's managed turn binds its agent ID through root work causality, preserving attribution of execution and resource evidence across provider changes.
- Discord starts one best-effort typing indicator after participation selects a response and before managed response work, retaining it across a scheduled response retry. Dedicated natural-language human turns skip semantic participation evaluation. Observed, throttled, and non-owner turns never flash speculative activity. Indicator failure does not block the answer.
- Natural-language routing defaults to at most 60 responses per agent per hour; standalone non-routing deployments default to 8. Explicit policy can lower either limit.
- Bounded recent turns from this bot deployment feed its responder with exact speaker participant, agent, and role coordinates, preserving agent-specific continuity without provider-native session memory.
- Gateway heartbeat and resume handling remain independent of provider work.

## Failure handling

- Persisted response failures retain a provider-neutral code and retry only through `maxResponseAttempts`.
- Exhaustion queues one fixed verified explanation instead of leaving the message silent.
- An unsafe retry-store failure marks conversation health unavailable as `interaction_retry_failed`.
