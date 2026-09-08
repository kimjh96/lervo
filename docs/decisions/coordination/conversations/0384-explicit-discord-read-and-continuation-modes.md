# ADR-0384: Natural-language Discord conversation routing

- Status: accepted
- Decision date: 2026-09-07

## Context

The first installed Discord composition treated every accepted mention as write-capable remote continuation. Repository questions entered the signed managed-write path and correctly failed when the provider produced no verified file change. A later draft separated read and write paths with `ask` and `continue` prefixes. It preserved authority boundaries but violated the requirement for ordinary conversation with or without a bot mention.

Lervo already separates provider-neutral contracts for read-only managed answers, signed remote continuation, conversation participation, bounded automation depth, and cross-provider deliberation. Natural-language routing composes these contracts without making Discord syntax a task authority.

## Decision

### Routing configuration

Optional `discordConversation.routing` enables natural-language routing and binds a distinct `readOnlyRoleId`. Its `intent`, `response`, and optional independent publication `evaluation` selections name `codex` or `claude`, with optional model and bounded reasoning-effort overrides. The existing command selection independently controls write-capable continuation. The managed host also accepts provider-keyed model and reasoning-effort settings for command execution. Every selected provider must be allowlisted by the managed provider host, which owns executable selection.

Under `mode: relevant`, every message from a mapped participant in a mapped conversation is eligible. A mention is an optional attention signal, not an intent selector. Deployments without routing retain legacy mention-only continuation.

### Intent resolution

The provider-backed intent adapter runs without model tools or repository capabilities. It receives:

- The integrity-checked message, actor kind, and optional-mention fact.
- At most four prior turns reconstructed from integrity-checked interaction records and CAS artifacts.
- The current workstream title, objective, and status.

It returns exactly one transient intent (`answer`, `continue_work`, or `clarify`) and confidence (`high`, `medium`, or `low`). Classification must use meaning and bounded context, never a keyword, prefix, regular expression, alias, or synonym list.

`answer` delegates to `ManagedConversationResponder`. `continue_work` delegates to the signed exact-workstream Hub command path only at medium or high confidence and only for a mapped human. `clarify`, low confidence, and agent-authored mutation requests stay with the read-only responder to answer or clarify without mutation. Resolver failure produces the existing retryable `response_generation_failed` interaction outcome.

An immutable local intent-resolution record binds the source event and message hash to intent, confidence, adapter version, provider, configured model, result digest, and resolution time. It contains no raw message. Restart recovery verifies and reuses this record without rerunning classification or rewriting its timestamp. Managed-run events and remote-command records independently retain the provider and model selected for read and write execution.

### Execution roles and language

The read-only execution role permits repository reads and denies filesystem writes, shell execution, network access, external messages, deployment, and data mutation. Each response receives the exact current workstream as required governance context so routine status answers need not rediscover it through provider tools. Participation identity remains distinct from execution role.

Natural replies use the versioned `writing_mul-conversation` contract and must use the message language unless another language is requested. Repository documentation remains English by default.

### Participants and agents

Participant bindings distinguish mapped humans from mapped agents. Optional `discordConversation.agentId` binds the responding bot participant to one active hired agent. Runtime startup verifies the agent's exact current role version, contract hash, profile hash, lifecycle status, and fixed-or-any provider policy. Stale or incompatible bindings fail as `invalid_config`.

The participation role is independent of `command.roleId`: a researcher may converse while a developer command role performs an explicitly authorized continuation. Agent participation is disabled by default and requires `agent` in `policy.respondTo`. The role template never becomes an actor.

Future `@agent`, `@role`, and deliberation-group routing can resolve eligible participants without changing the normalized event or natural-language intent port. Deliberation identity, turn ownership, automation depth, hourly limits, self-message suppression, and explicit effect authority must prevent uncontrolled agent loops. Write-capable remote continuation remains human-only.

A `discordConversations` deployment requires one distinct active hired agent per distinct Discord application and automatically maps peer author and mention identities as specified by ADR-0385.

### Platform activity and queues

Transient typing starts only after participation chooses `respond`; it does not run for observed, duplicate, busy, or throttled input. Typing refresh and failure remain outside semantic intent, provider execution, publication evidence, and durable delivery. Gateway heartbeat and resume processing remain outside the ordered provider-work queue so a slow answer cannot make the next message disappear.

### Latency profile

The measured pre-change read-response baseline was 19.6–51.4 seconds across seven recent managed runs. The slowest provider turn took 42.8 seconds before independent publication evaluation.

The installed configuration uses a no-capability low-effort Claude Haiku intent pass, a low-effort GPT-5.6 Sol read response, a separate low-effort Claude Haiku publication evaluation, and high-effort Claude Sonnet 4.6 for mutation. The user selected this provider split; authenticated local CLI smoke calls established pinned response and mutation model compatibility.

This deployment profile is not a core default. Each hired-agent bot may replace it independently, and live round-trip evidence owns any latency claim.

### Data boundaries

Raw message text stays in the existing bounded CAS path. Intent input and bounded prior turns are not copied into health, policy, result-correlation, or repository documentation. Context is reconstructed from existing durable interaction records and content hashes, so a Node restart does not erase the local conversation. Multi-host history replication remains a separate evidence-bound projection.

## Consequences

Operators can speak naturally in configured Discord channels; mentioning the bot does not change semantics. Informational and mutating requests retain separate execution roles, evidence, and failure behavior. Participation, semantic intent, managed reading, signed continuation, deliberation, and platform delivery remain independently replaceable modules.

Live external acceptance requires an unmentioned informational question to produce a provider-generated answer and a natural-language mutation request to enter the signed continuation path. Mac-offline source transfer remains a separate outcome.

## References

- [Discord-first remote continuation intake](0381-discord-first-remote-continuation-intake.md)
- [Node-hosted Discord conversation service](0382-node-hosted-discord-conversation-service.md)
- [Durable conversation execution result return](0383-durable-conversation-execution-result-return.md)
- [Role-scoped managed conversation responses](../../release/packaging/0047-managed-conversation-responder.md)
- [Cross-provider deliberation runtime](../../execution/providers/0029-cross-provider-deliberation-runtime.md)
- [Distinct Discord identities for hired agents](0385-distinct-discord-agent-identities.md)
