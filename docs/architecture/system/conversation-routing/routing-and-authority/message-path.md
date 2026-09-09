# Message path

For mapped channels and participants, ordinary messages and bot mentions share one path; mentions only signal attention. One surface-neutral managed conversation turn receives:

- The integrity-checked message and up to four integrity-checked recent turns.
- Actor kind and mention fact.
- The responding hired agent and role identity.
- The exact current workstream and repository instructions.
- Product-default search, repository-knowledge, and relation recommendations.
- Caller-declared effect kinds and bounded argument contracts.

The turn returns `answer`, `continue_work`, or `clarify` with confidence, one structured effect, a per-agent `relevant` or `not_relevant` participation result, and a natural reply for read-only outcomes. Participation, response routing, and publication reuse this immutable result. Exact participant and role mentions are addressed by contract, independently of relevance claims.

Mapped natural-language deployments default `unaddressedHumanMessages` to `respond`: an eligible human message enters its deterministic owner's managed response path without spending or depending on a semantic relevance call. Its `owned_human_message` decision records `relevance=not_checked`, not a model judgment of relevance. Selective shared-channel deployments may choose `evaluate`. Unaddressed agent messages always retain semantic participation gating. Uncorrelated agent messages also enter at the maximum automation depth unless the exact participant binding is a reviewed automation-chain starter; that starter begins at depth zero without bypassing any other participation or authority check.

The mapped natural-language default allows 60 responses per agent per hour, versus the conservative standalone limit of 8. Deployments may explicitly lower the bound. Cooldown, automation depth, deterministic ownership, and provider budgets remain independent controls.

Recent turns retain speaker kind, participant ID, durable agent ID when present, and role ID. Responders distinguish humans, themselves, and peer agents without display names or provider-native memory.

Medium- or high-confidence human `repository_work` enters the existing signed Hub command path. An explicitly allowed Discord effect enters the scoped administration adapter. Unsupported effects and all other outcomes stay in the read-only managed responder.

Provider failure is classified and bounded; it never grants write or platform authority. Exhaustion queues a deterministic explanatory response rather than leaving the message silent. The installed managed path uses `routing.response` once. `routing.intent` remains a backward-compatible custom-composition fallback, not another production model round trip.
