# Message path

For mapped channels and participants, ordinary messages and bot mentions follow the same path; mentions only signal attention. A no-capability intent adapter receives:

- The integrity-checked message.
- Up to four integrity-checked recent turns.
- Actor kind and mention fact.
- Current workstream summary.
- Available effect kinds.

It returns `answer`, `continue_work`, or `clarify` with confidence and one structured effect.

Medium- or high-confidence human `repository_work` enters the existing signed Hub command path. An explicitly allowed Discord effect enters the scoped administration adapter. Unsupported effects and all other outcomes remain in the read-only managed responder.

Provider failure is retryable and never grants write or platform authority.
