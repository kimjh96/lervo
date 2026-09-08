# Example behavior

- Every ordinary message by the mapped human in the mapped channel enters the conversation. A bot mention is accepted but optional.
- A no-capability Claude adapter resolves the natural-language turn against bounded recent conversation context and the current workstream.
- The same resolution decides whether this exact hired agent has a role-relevant contribution. Unaddressed peer turns may remain silent without a second model call.
- Informational intent runs the read-only managed responder through Codex with the exact workstream already injected.
- Clear repository change or continuation intent queues the command's Claude exact-workstream path.
- An allowed request to change this bot's guild nickname calls the scoped Discord current-member adapter and verifies the returned application identity and nickname. It does not queue repository work.
- Ambiguity remains read-only so the responder can clarify without changing repository or external state.
- Omitting `routing.evaluation` selects the deterministic realtime chat contract and avoids a second synchronous model call. An evaluation object enables the separate schema-constrained semantic pass without changing response provider identity.
- Each selected provider and configured model is retained at its own execution, configuration, or intent-resolution boundary. A hired bot's managed read run binds its agent ID through root work causality, keeping execution and resource evidence attributable across provider changes.
- Discord refreshes one best-effort typing indicator during long provider work and retains it across a scheduled response retry. Indicator failure does not block the answer.
- Bounded recent turns from this bot deployment feed its responder with exact speaker participant, agent, and role coordinates, preserving agent-specific conversational continuity without provider-native session memory.
- Gateway heartbeat and resume handling remain independent of provider work.
- Persisted response failures retain a provider-neutral code and retry only through `maxResponseAttempts`. Exhaustion queues one fixed verified explanation instead of leaving the message silent. An unsafe retry-store failure marks conversation health unavailable as `interaction_retry_failed`.
