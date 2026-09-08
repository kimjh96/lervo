# Natural-language conversation routing

Status: `active`

The installed Node separates Discord transport, normalized identity, participation policy, semantic intent, managed response, remote continuation, publication, and durable evidence. Platform adapters do not choose repository effects; provider adapters do not enter conversation or authority contracts.

## Message path

For mapped channels and participants, ordinary messages and bot mentions follow the same path; mentions only signal attention. A no-capability intent adapter receives the integrity-checked message, up to four integrity-checked recent turns, actor kind, mention fact, and current workstream summary. It returns `answer`, `continue_work`, or `clarify` with confidence.

Medium- or high-confidence human continuation enters the existing signed Hub command path. All other outcomes stay in the read-only managed responder. Provider failure is retryable and never grants write authority.

## Gateway control

Discord Gateway control frames and application dispatch use separate ordered queues. Sequence, heartbeat acknowledgement, reconnect, and resume handling never wait for intent resolution or provider execution. Authenticated application dispatch stays ordered and retains its bounded session proof across reconnect. A long response therefore cannot create a false missed-heartbeat window that discards a following message.

Gateway resume coordinates intentionally remain process-local. On READY or RESUMED, a Discord REST history adapter reads after the platform SQLite channel cursor before readiness is published. A conversation-owned ingress processor orders recovered messages, reuses normal adapter and interaction handling, and advances the cursor with compare-and-set only after processing. First installation records a current baseline instead of importing prior channel history; existing databases seed from their newest Discord correlation. A 1,000-message startup bound fails closed rather than hiding an unbounded gap.

## Typing indicator

After participation policy chooses `respond`, the Discord adapter starts a transient typing lease, refreshing every eight seconds within Discord's ten-second expiry. Response completion, retry scheduling, or publication failure stops refresh.

Ignored, duplicate, busy, rate-limited, and other observe-only inputs do not start typing. `platform_activity_failed` means the best-effort indicator could not be sent; it creates no receipt or durable state and cannot change the response outcome.

## Response recovery

Accepted interactions are persisted before provider work. Generation or publication failure returns the inbox record to a time-bounded pending state. A conversation-owned retry loop processes one ready record at a time without another Discord message, independently of Gateway control traffic, and recovers expired leases after process interruption. Selection requires exact current integration, policy, and role coordinates. Older-policy pending records are retained but cannot block current work or acquire the current policy's meaning.

History reconciliation covers the earlier boundary: a message that reached Discord while the Node process was unavailable. Durable inbox retry covers the later boundary: a message already normalized and correlated before processing failed. Neither mechanism substitutes for the other.

Provider-backed writing evaluation uses provider adapters' JSON-schema output boundary before validating the exact evaluation response contract. Invalid or unavailable evaluation stays fail-closed and retryable. `interaction_retry_failed` means the worker could not safely inspect or advance its durable inbox: the Node marks conversation health unavailable and exits through its existing supervised failure path. The health code contains no message or provider output.

The read responder persists a bounded request-digest-to-CAS-artifact coordinate after managed-run and independent-session validation but before publication evaluation. Evaluator-only retry reuses that artifact across process restart. A definitive writing-policy rejection removes it so regeneration remains possible. Cache state never bypasses publication evaluation or its separate provider boundary.

## Provider and evidence design

Intent, read response, independent writing evaluation, and write continuation select providers independently. Codex and Claude implement common provider-neutral ports; model and reasoning choices remain adapter configuration.

Immutable intent evidence binds event ID, message hash, provider, model, adapter version, result digest, and resolution time without copying raw message text. After process restart, retries read and verify that exact resolution rather than invoking the classifier again or rewriting immutable evidence. Managed-run events separately record the actual response or command provider. Conversation history reuses completed interaction records and CAS content, preserving local context across restart.

## Identity and authority

Participant identity, read-only execution role, and mutation command role remain distinct. Human mappings carry no role. At startup, the configured responding agent ID is resolved from the workforce store and must be active with current role and provider-policy hashes. A role template is not an actor.

Agent-authored discussion is disabled by default. When enabled, participation rate and automation depth bound it, and it cannot request repository mutation through conversation routing.

Workforce provider authority may be fixed to Codex or Claude or remain policy-selectable. A future automatic selector must bind the exact model, policy version, reason, availability, capability, cost, and latency checks, failing closed when none qualifies.

## Configuration and composition

Configuration parsing separates channel and participant bindings from routing and execution behavior. Runtime composition separately owns Hub continuation, provider construction, persistent history, immutable intent evidence, managed read execution, publication verification, retry scheduling, and deployment lifecycle. New platforms and providers stay behind adapters; role-backed deliberation can reuse identity and evidence contracts without expanding authority.

A Node may supervise one to eight Discord bot deployments. Each independently maintains its Discord application and owner-only credential, hired-agent and role binding, provider/model routing, storage, Gateway session, and delivery adapter.

The collection-level supervisor owns only aggregate readiness, failure, result delivery, and shutdown. It reports ready only after every Gateway is ready, fails the Node if any member runtime fails, and attempts to close every member.

Shared-channel peer aliases map each external bot author and mention to one exact workforce participant without merging credentials, runtime state, or provider policy. Compatible single-bot configuration uses the same per-deployment runtime boundary.

## References

See [ADR-0384](../../decisions/coordination/conversations/0384-explicit-discord-read-and-continuation-modes.md), [ADR-0385](../../decisions/coordination/conversations/0385-distinct-discord-agent-identities.md), and [Node runtime distribution](../../distribution/node-runtime-distribution.md).
