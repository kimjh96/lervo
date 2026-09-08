# Message path

For mapped channels and participants, ordinary messages and bot mentions follow the same path; mentions only signal attention. A no-capability intent adapter receives the integrity-checked message, up to four integrity-checked recent turns, actor kind, mention fact, and current workstream summary. It returns `answer`, `continue_work`, or `clarify` with confidence.

Medium- or high-confidence human continuation enters the existing signed Hub command path. All other outcomes remain in the read-only managed responder. Provider failure is retryable and never grants write authority.
