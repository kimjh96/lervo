# Message path

Ordinary messages and bot mentions from mapped channels and participants share one path; mentions signal attention only. One surface-neutral managed conversation turn receives:

- The integrity-checked message and up to four integrity-checked recent turns.
- Actor kind and mention fact.
- Responding hired agent and role identity.
- Exact current workstream and repository instructions.
- Product-default search, repository-knowledge, and relation recommendations.
- Caller-declared effect kinds and bounded argument contracts.

The turn returns `answer`, `continue_work`, or `clarify`, confidence, one structured effect, a per-agent `relevant` or `not_relevant` participation result, and a natural reply for read-only outcomes. Participation, response routing, and publication reuse this immutable result. Exact participant and role mentions are addressed by contract independently of relevance claims.

## Participation and limits

Mapped natural-language deployments default `unaddressedHumanMessages` to `evaluate`: before responding, the deterministic owner judges whether it has a materially useful role-specific contribution. Dedicated human dialogues requiring an answer to every mapped message may select `respond`, recording `relevance=not_checked`. In shared channels, the owner may delegate a bounded task to an eligible specialist without the human naming that agent.

Unaddressed agent messages always retain semantic participation gating. Uncorrelated agent messages enter at maximum automation depth unless the exact participant binding is a reviewed automation-chain starter. A starter begins at depth zero but retains all other participation and authority checks.

The mapped natural-language default is 60 responses per agent per hour; the conservative standalone limit is 8. Deployments may explicitly lower the bound. Cooldown, automation depth, deterministic ownership, and provider budgets remain independent controls.

Recent turns retain speaker kind, participant ID, durable agent ID when present, and role ID. Responders distinguish humans, themselves, and peer agents without display names or provider-native memory.

## Authority and failure handling

An admitted `repository_work` request enters the installed owner's [shared supervision intake](../../../../specifications/execution/outcome-supervision/implementation/node-composition/installed-startup/request-intake.md) when this Node's exact responding agent owns the configured mandate. Other natural Discord deployments use the resumable native repository-work responder. The separate signed Hub command path handles exact reviewed remote effects. An explicitly allowed Discord effect enters the scoped administration adapter. Unsupported effects and all other outcomes remain in the read-only managed responder.

Provider failure is classified and bounded; it never grants write or platform authority. Exhaustion queues a deterministic explanatory response rather than leaving the message silent. The installed managed path uses `routing.response` once. `routing.intent` remains a backward-compatible custom-composition fallback, not another production model round trip.
