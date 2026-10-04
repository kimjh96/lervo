# Example behavior

## Intent and routing

- Every ordinary message from the mapped human in the mapped channel enters the conversation; bot mentions are optional.
- One read-only Codex managed turn resolves intent, the exact hired agent's role-relevant participation, a bounded effect, and any informational reply.
- Unaddressed peer turns may remain silent without another model call.
- The turn receives the exact workstream and qualified search, repository-knowledge, and relation recommendations.
- Clear repository change or continuation intent queues the command's Claude exact-workstream path.
- An allowed request to change this bot's guild nickname calls the scoped Discord current-member adapter and verifies the returned application identity and nickname. It does not queue repository work.
- An allowed request to open or close one configured runtime selects an exact runtime ID. The Node, rather than the provider child process, owns it through explicit close, bounded expiry, or Node shutdown. It is never boot-enabled or unconditionally restarted.
- Ambiguity remains read-only: clarification changes neither repository nor external state.

## Execution and continuity

- Omitting `routing.evaluation` selects the deterministic realtime chat contract and avoids a second synchronous model call. An evaluation object enables a separate schema-constrained semantic pass without changing response provider identity.
- Each selected provider and configured model remains at its own execution boundary. A hired bot's managed turn binds its agent ID through root work causality, preserving execution and resource evidence attribution across provider changes.
- Discord starts one best-effort typing indicator after participation selects a response and before managed response work, retaining it across a scheduled response retry. Dedicated natural-language human turns skip semantic participation evaluation. Observed, throttled, and non-owner turns never flash speculative activity. Indicator failure does not block the answer.
- Natural-language routing defaults to at most 60 responses per agent per hour; standalone non-routing deployments default to 8. Explicit policy can lower either limit.
- `policy.unaddressedPriority` selects the shared-channel default without role-name checks.
- `policy.acceptsSupervisionGoals` exposes natural-language durable goal intake only when the deployment's `agentId` exactly matches the installed `outcomeSupervision` owner. Configuration preflight rejects a missing or mismatched binding.
- `policy.acceptsPeerWork` lets an exactly bound peer request repository work only through an addressed, bounded agent turn. It does not authorize unknown or unaddressed agent messages.
- A role named `CEO` or `product-owner` grants none of these policy behaviors by itself.
- Bounded recent turns from this bot deployment feed its responder with exact speaker participant, agent, and role coordinates, preserving agent-specific continuity without provider-native session memory.
- Gateway heartbeat and resume handling remain independent of provider work.

## Failure handling

- Persisted response failures retain a provider-neutral code and retry only through `maxResponseAttempts`.
- Exhaustion queues one fixed verified terminal fallback because the managed writer is unavailable. Normal action and supervision outcomes always use the managed conversation writer.
- An unsafe retry-store failure marks conversation health unavailable as `interaction_retry_failed`.
