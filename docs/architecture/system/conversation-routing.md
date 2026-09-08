# Natural-language conversation routing

Status: `active`

The installed Node separates Discord transport, normalized identity, participation policy, semantic intent, managed response, remote continuation, publication, and durable evidence. Platform adapters do not choose repository effects, and provider adapters do not enter conversation or authority contracts.

## Message path

For a mapped channel and participant, ordinary messages and bot mentions follow the same path; a mention is only an attention signal. A no-capability intent adapter receives the integrity-checked message, up to four integrity-checked recent turns, actor kind, mention fact, and current workstream summary. It returns `answer`, `continue_work`, or `clarify` with confidence.

A medium- or high-confidence human continuation enters the existing signed Hub command path. Every other outcome remains in the read-only managed responder. Provider failure is retryable and never falls through to write authority.

## Gateway control

Discord Gateway control frames and application dispatch use separate ordered queues. Sequence, heartbeat acknowledgement, reconnect, and resume handling never wait for intent resolution or provider execution. Authenticated application dispatch remains ordered and retains its bounded session proof across reconnect. Therefore, a long response cannot create a false missed-heartbeat window that discards a following message.

## Typing indicator

After participation policy chooses `respond`, the Discord adapter starts a transient typing lease and refreshes it every eight seconds within Discord's ten-second expiry. Response completion, retry scheduling, or publication failure stops refresh.

Typing does not start for ignored, duplicate, busy, rate-limited, or otherwise observe-only input. `platform_activity_failed` means this best-effort indicator could not be sent. It creates no receipt or durable state and cannot change the message response outcome.

## Provider and evidence design

Intent, read response, independent writing evaluation, and write continuation select providers independently. Codex and Claude implement common provider-neutral ports; model and reasoning choices remain adapter configuration.

Intent evidence is immutable and binds the event ID, message hash, provider, model, adapter version, result digest, and resolution time without copying raw message text. Managed-run events separately record the actual response or command provider. Conversation history reuses completed interaction records and CAS content, so process restart does not erase local context.

## Identity and authority

Participant identity, read-only execution role, and mutation command role remain distinct. Human mappings carry no role. At startup, a configured responding agent ID is resolved from the workforce store and must be active with current role and provider-policy hashes. The role template is not an actor.

Agent-authored discussion is disabled by default. When enabled, it is bounded by participation rate and automation depth and cannot request repository mutation through conversation routing.

Workforce provider authority may be fixed to Codex or Claude or remain policy-selectable. A future automatic selector must bind the exact model, policy version, reason, availability, capability, cost, and latency checks, and fail closed when none qualifies.

## Configuration and composition

Configuration parsing separates channel and participant bindings from routing and execution behavior. Runtime composition separately owns Hub continuation, provider construction, persistent history, immutable intent evidence, managed read execution, publication verification, and deployment lifecycle. This keeps new platforms and providers behind adapters and lets role-backed deliberation reuse identity and evidence contracts without expanding authority.

A Node may supervise one to eight Discord bot deployments. Each deployment independently maintains its Discord application and owner-only credential, hired-agent and role binding, provider/model routing, storage, Gateway session, and delivery adapter.

A collection-level supervisor owns only aggregate readiness, failure, result delivery, and shutdown. It reports ready only after every Gateway is ready, fails the Node when any member runtime fails, and attempts to close every member.

Shared-channel peer aliases map each external bot author and mention to one exact workforce participant. They do not merge credentials, runtime state, or provider policy. Compatible single-bot configuration follows the same per-deployment runtime boundary.

## References

See [ADR-0384](../../decisions/coordination/conversations/0384-explicit-discord-read-and-continuation-modes.md), [ADR-0385](../../decisions/coordination/conversations/0385-distinct-discord-agent-identities.md), and [Node runtime distribution](../../distribution/node-runtime-distribution.md).
