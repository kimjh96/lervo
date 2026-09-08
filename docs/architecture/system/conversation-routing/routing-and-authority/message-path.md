# Message path

For mapped channels and participants, ordinary messages and bot mentions follow the same path; mentions only signal attention. A no-capability intent adapter receives:

- The integrity-checked message.
- Up to four integrity-checked recent turns.
- Actor kind and mention fact.
- The responding hired agent and role identity.
- Current workstream summary.
- Available effect kinds.

The adapter returns `answer`, `continue_work`, or `clarify` with confidence, one structured effect, and a per-agent `relevant` or `not_relevant` participation result. Participation and response routing reuse this immutable result, avoiding a second semantic participation call. Exact participant and role mentions are addressed by contract, independently of relevance claims.

Recent turns retain speaker kind, participant ID, durable agent ID when present, and role ID. Responders can distinguish the human, themselves, and peer agents without relying on display names or provider-native memory.

Medium- or high-confidence human `repository_work` enters the existing signed Hub command path. An explicitly allowed Discord effect enters the scoped administration adapter. Unsupported effects and all other outcomes remain in the read-only managed responder.

Provider failure is retryable and never grants write or platform authority.
