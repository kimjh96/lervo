# Routing, identity, and evidence

## Message path

For mapped channels and participants, ordinary messages and bot mentions follow the same path; mentions only signal attention. A no-capability intent adapter receives the integrity-checked message, up to four integrity-checked recent turns, actor kind, mention fact, and current workstream summary. It returns `answer`, `continue_work`, or `clarify` with confidence.

Medium- or high-confidence human continuation enters the existing signed Hub command path. All other outcomes remain in the read-only managed responder. Provider failure is retryable and never grants write authority.

## Provider and evidence design

Intent, read response, independent writing evaluation, and write continuation select providers independently. Codex and Claude implement common provider-neutral ports; model and reasoning choices remain adapter configuration.

Immutable intent evidence binds event ID, message hash, provider, model, adapter version, result digest, and resolution time without copying raw message text. After restart, retries read and verify that exact resolution without invoking the classifier again or rewriting immutable evidence. Managed-run events separately record the actual response or command provider. Conversation history reuses completed interaction records and CAS content to preserve local context across restart.

## Identity and authority

Participant identity, read-only execution role, and mutation command role remain distinct. Human mappings carry no role. At startup, the configured responding agent ID is resolved from the workforce store and must be active with current role and provider-policy hashes. A role template is not an actor.

Agent-authored discussion is disabled by default. When enabled, participation rate and automation depth bound it; it cannot request repository mutation through conversation routing.

Workforce provider authority may be fixed to Codex or Claude or remain policy-selectable. A future automatic selector must bind the exact model, policy version, reason, availability, capability, cost, and latency checks, failing closed when none qualifies.
