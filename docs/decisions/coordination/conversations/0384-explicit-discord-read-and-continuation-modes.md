# ADR-0384: Natural-language Discord conversation routing

- Status: accepted
- Decision date: 2026-09-07

## Context

The first installed Discord composition treated every accepted mention as a write-capable remote continuation. A repository question therefore entered the signed managed-write path and correctly failed when the provider produced no verified file change. A later draft exposed `ask` and `continue` prefixes to separate read and write paths; it preserved authority boundaries but failed the product requirement that an operator converse in ordinary language, with or without a bot mention.

Lervo already has separate provider-neutral contracts for read-only managed answers, signed remote continuation, conversation participation, bounded automation depth, and cross-provider deliberation. Natural-language routing should compose those contracts without making Discord syntax a new task authority.

## Decision

### Routing configuration

An optional `discordConversation.routing` object enables natural-language routing and binds a distinct `readOnlyRoleId`. Its `intent`, `response`, and optional independent publication `evaluation` selections name `codex` or `claude`, with optional model and bounded reasoning-effort overrides; the existing command selection independently controls write-capable continuation. The managed host also accepts provider-keyed model and reasoning-effort settings for command execution. Every selected provider must be allowlisted by the managed provider host, which also owns executable selection. Every message from a mapped participant in a mapped conversation is eligible under `mode: relevant`; a mention is an optional attention signal, not an intent selector. Deployments without routing retain legacy mention-only continuation behavior.

### Intent resolution

The provider-backed intent adapter runs without model tools or repository capabilities. It receives the integrity-checked message, actor kind, optional-mention fact, at most four prior turns reconstructed from integrity-checked interaction records and CAS artifacts, and the current workstream title, objective, and status. It returns exactly one transient intent (`answer`, `continue_work`, or `clarify`) and confidence (`high`, `medium`, or `low`). The adapter must classify by meaning and bounded context, never by a keyword, prefix, regular expression, alias, or synonym list.

`answer` delegates to `ManagedConversationResponder`. `continue_work` delegates to the signed exact-workstream Hub command path only at medium or high confidence and only for a mapped human. `clarify`, low confidence, and an agent-authored mutation request remain on the read-only responder so it can answer or ask for clarification without mutation. Resolver failure causes the existing retryable `response_generation_failed` interaction outcome. An immutable local intent-resolution record binds the source event and message hash to intent, confidence, adapter version, provider, configured model, result digest, and resolution time; it contains no raw message. Managed-run events and remote-command records independently retain the provider and model selected for read and write execution.

### Execution roles and language

The read-only execution role allows repository reads and denies filesystem writes, shell execution, network access, external messages, deployment, and data mutation. The exact current workstream is injected as required governance context for each response so routine status answers do not rediscover it through provider tools. Participation identity remains distinct from execution role. Natural replies use the versioned `writing_mul-conversation` contract and must answer in the message language unless another language is requested. Repository documentation remains English by default.

### Participants and agents

Participant bindings distinguish mapped humans from mapped agents. Optional `discordConversation.agentId` binds the responding bot participant to one active hired agent. Runtime startup verifies the agent's exact current role version, contract hash, profile hash, lifecycle status, and fixed-or-any provider policy; stale or incompatible bindings fail as `invalid_config`. The participation role is independent of `command.roleId`, so a researcher may converse while a developer command role performs an explicitly authorized continuation. Agent participation is disabled by default and requires `agent` in `policy.respondTo`. The role template never becomes an actor. Future `@agent`, `@role`, and deliberation-group routing can resolve eligible participants without changing the normalized event or natural-language intent port. Deliberation identity, turn ownership, automation depth, hourly limits, self-message suppression, and explicit effect authority must prevent uncontrolled agent loops. Write-capable remote continuation remains human-only.

A `discordConversations` deployment requires one distinct active hired agent for each distinct Discord application and automatically maps peer author and mention identities as specified by ADR-0385.

### Platform activity and queues

The platform begins a transient typing activity only after participation chooses `respond`; it does not run for observed, duplicate, busy, or throttled input. Typing refresh and failure remain outside semantic intent, provider execution, publication evidence, and durable delivery. Gateway heartbeat and resume processing likewise remain outside the ordered provider-work queue so a slow answer cannot make the next message disappear.

### Latency profile

The measured pre-change read-response baseline was 19.6–51.4 seconds for seven recent managed runs, with the slowest provider turn taking 42.8 seconds before independent publication evaluation. The installed configuration uses a no-capability low-effort Claude Haiku intent pass, a low-effort GPT-5.6 Sol read response, a separate low-effort Claude Haiku publication evaluation, and high-effort Claude Sonnet 4.6 for mutation. The user selected the provider split; authenticated local CLI smoke calls established the pinned response and mutation model compatibility. This is a deployment profile rather than a core default: each hired-agent bot may replace it independently, and live round-trip evidence owns any latency claim.

### Data boundaries

Raw message text remains in the existing bounded CAS path. Intent input and bounded prior turns are not copied into health, policy, result-correlation, or repository documentation. Conversation context is reconstructed from the existing durable interaction records and content hashes, so a Node restart does not erase the local conversation. Multi-host history replication remains a separate evidence-bound projection.

## Consequences

An operator can speak naturally in the configured Discord channel and may mention the bot without changing semantics. Informational and mutating requests retain separate execution roles, evidence, and failure behavior. Participation, semantic intent, managed reading, signed continuation, deliberation, and platform delivery remain independently replaceable modules.

Live external acceptance requires one unmentioned informational question to produce a provider-generated answer and one natural-language mutation request to enter the signed continuation path. Mac-offline source transfer remains a separate outcome.

## References

- [Discord-first remote continuation intake](0381-discord-first-remote-continuation-intake.md)
- [Node-hosted Discord conversation service](0382-node-hosted-discord-conversation-service.md)
- [Durable conversation execution result return](0383-durable-conversation-execution-result-return.md)
- [Role-scoped managed conversation responses](../../release/packaging/0047-managed-conversation-responder.md)
- [Cross-provider deliberation runtime](../../execution/providers/0029-cross-provider-deliberation-runtime.md)
- [Distinct Discord identities for hired agents](0385-distinct-discord-agent-identities.md)
