# Message path

For mapped channels and participants, ordinary messages and bot mentions follow the same path; mentions only signal attention. One surface-neutral managed conversation turn receives:

- The integrity-checked message.
- Up to four integrity-checked recent turns.
- Actor kind and mention fact.
- The responding hired agent and role identity.
- The exact current workstream and repository instructions.
- Product-default search, repository-knowledge, and relation recommendations.
- Caller-declared effect kinds and their bounded argument contracts.

The managed turn returns `answer`, `continue_work`, or `clarify` with confidence, one structured effect, a per-agent `relevant` or `not_relevant` participation result, and a natural reply for read-only outcomes. Participation, response routing, and publication reuse this immutable result. Exact participant and role mentions are addressed by contract, independently of relevance claims.

Recent turns retain speaker kind, participant ID, durable agent ID when present, and role ID. Responders distinguish the human, themselves, and peer agents without relying on display names or provider-native memory.

Medium- or high-confidence human `repository_work` enters the existing signed Hub command path. An explicitly allowed Discord effect enters the scoped administration adapter. Unsupported effects and all other outcomes remain in the read-only managed responder.

Provider failure is retryable and never grants write or platform authority. The installed managed path uses `routing.response` once; `routing.intent` is a backward-compatible custom-composition fallback, not another production model round trip.
