# Natural-language conversation routing

Status: `active`

The installed Node composes Discord transport, normalized identity, participation policy, semantic intent, managed response, remote continuation, publication, and durable evidence as separate boundaries. Platform adapters do not choose repository effects, and provider adapters do not enter the conversation or authority contracts.

For a mapped channel and participant, an ordinary message and a bot mention follow the same path. The mention is only an attention signal. A no-capability intent adapter receives the integrity-checked message, up to four integrity-checked recent turns, actor kind, mention fact, and current workstream summary. It returns `answer`, `continue_work`, or `clarify` with confidence. A medium- or high-confidence human continuation enters the existing signed Hub command path; every other outcome remains in the read-only managed responder. Provider failure is retryable and never falls through to write authority.

The intent, read response, and write continuation paths select providers independently. Codex and Claude implement common provider-neutral ports, and each execution boundary records the provider and configured model that it can observe. Intent evidence is immutable and binds the event ID, message hash, provider, model, adapter version, result digest, and resolution time without copying raw message text. Conversation history reuses completed interaction records and CAS content, so process restart does not erase local context.

Participant identity and execution role remain distinct. Human mappings carry no role. An agent mapping identifies a hired agent instance and its exact role; the role template is not an actor. Agent-authored discussion is disabled by default, bounded by participation rate and automation depth when enabled, and cannot request repository mutation through conversation routing. Workforce provider authority may be fixed to Codex or Claude or left policy-selectable. A future automatic selector must bind the exact model, policy version, reason, availability, capability, cost, and latency checks and fail closed when none qualifies.

Configuration parsing separates channel and participant bindings from routing and execution behavior. Runtime composition separately owns Hub continuation, provider construction, persistent history, immutable intent evidence, managed read execution, publication verification, and deployment lifecycle. This keeps new platforms and providers behind adapters and allows role-backed deliberation to reuse the identity and evidence contracts without expanding authority.

See [ADR-0384](../../decisions/coordination/conversations/0384-explicit-discord-read-and-continuation-modes.md) and [Node runtime distribution](../../distribution/node-runtime-distribution.md).
