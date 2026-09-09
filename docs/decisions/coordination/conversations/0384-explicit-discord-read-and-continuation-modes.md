# ADR-0384: Natural-language Discord conversation routing

- Status: accepted
- Decision date: 2026-09-07

## Context

The first installed Discord composition treated every accepted mention as write-capable remote continuation. Repository questions entered the signed managed-write path and correctly failed without a verified provider file change. A later `ask`/`continue` prefix draft preserved authority boundaries but violated the requirement for ordinary conversation with or without a bot mention.

Lervo separates provider-neutral contracts for read-only managed answers, signed remote continuation, conversation participation, bounded automation depth, and cross-provider deliberation. Natural-language routing composes these without making Discord syntax a task authority.

## Decision

### Routing configuration

Optional `discordConversation.routing` enables natural-language routing and binds a distinct `readOnlyRoleId`. Its `intent`, `response`, and optional independent publication `evaluation` selections name `codex` or `claude`, with optional model and bounded reasoning-effort overrides. Existing command selection independently controls write-capable continuation. The managed host also accepts provider-keyed model and reasoning-effort settings for command execution. Every selected provider must be allowlisted by the managed provider host, which owns executable selection.

Under `mode: relevant`, every message from a mapped participant in a mapped conversation is eligible. Mentions are optional attention signals, not intent selectors. `policy.unaddressedHumanMessages` separates dedicated human dialogue from semantic multi-agent participation: `respond` routes eligible human messages directly to their deterministic owner; `evaluate` retains semantic filtering. Natural-language routing defaults to `respond`. Deployments without routing retain legacy mention-only continuation and semantic filtering.

### Intent resolution

The provider-backed intent adapter has no model tools or repository capabilities. It receives the integrity-checked message, actor kind, optional-mention fact, at most four prior turns reconstructed from integrity-checked interaction records and CAS artifacts, and the current workstream title, objective, and status.

It returns exactly one transient intent (`answer`, `continue_work`, or `clarify`), confidence (`high`, `medium`, or `low`), and a structured effect limited to available runtime effects. Classification uses meaning and bounded context, never keywords, prefixes, regular expressions, aliases, or synonym lists.

`answer` delegates to `ManagedConversationResponder`. Medium- or high-confidence human `continue_work` with `repository_work` delegates to the signed exact-workstream Hub command path. An explicitly allowlisted Discord platform effect delegates to its scoped adapter and never enters repository continuation. Agent-authored mutation requests stay with the read-only responder unless the exact configured agent participant, role, tenant, and mapped conversation separately opt in to effect requests. An admitted agent request still enters the same signed continuation or scoped platform-effect boundary and gains no command role, effect kind, repository permission, or provider capability from conversation routing. `clarify`, low confidence, and unavailable effects stay with the read-only responder. Resolver failure for an owned human message enters the classified response-failure contract and produces a verified visible terminal response immediately or after only a proven transient retry; it cannot become a silent `relevance_unavailable` observation.

An immutable local intent-resolution record binds the source event and message hash to intent, confidence, structured effect, adapter version, provider, configured model, result digest, and resolution time. It contains no raw message. Restart recovery verifies and reuses it without reclassification or timestamp changes. Managed-run events and remote-command records independently retain the provider and model selected for read and write execution.

### Execution roles and language

The read-only execution role permits repository reads and denies filesystem writes, shell execution, network access, external messages, deployment, and data mutation. Every response receives the exact current workstream as required governance context, avoiding provider-tool rediscovery for routine status answers. Participation identity remains distinct from execution role.

Natural replies use the versioned `writing_mul-realtime-conversation` contract unless an independent evaluation provider selects `writing_mul-conversation`. Both require the message language unless another language is requested; the realtime contract claims deterministic verification only. Repository documentation defaults to English.

### Participants and agents

Participant bindings distinguish mapped humans from mapped agents. Optional `discordConversation.agentId` binds the responding bot participant to one active hired agent. Startup verifies the agent’s exact current role version, contract hash, profile hash, lifecycle status, and fixed-or-any provider policy. Stale or incompatible bindings fail as `invalid_config`.

The participation role is independent of `command.roleId`: a researcher may converse while a developer command role performs an explicitly authorized continuation. Agent participation is disabled by default and requires `agent` in `policy.respondTo`. The role template never becomes an actor.

Future `@agent`, `@role`, and deliberation-group routing can resolve eligible participants without changing the normalized event or natural-language intent port. Deliberation identity, turn ownership, automation depth, hourly limits, self-message suppression, and explicit effect authority must prevent uncontrolled agent loops. Write-capable remote continuation remains human by default. A reviewed coordinating agent may request it only through the separate exact effect-requester opt-in described above.

A `discordConversations` deployment requires one distinct active hired agent per speaker deployment. It automatically maps peer bot or webhook authors and bot mention identities as specified by [ADR-0394](0394-webhook-backed-discord-agent-identities.md).

### Platform activity and queues

Transient typing starts only after participation chooses `respond`, never for observed, duplicate, busy, or throttled input. One conversation-owned activity lease persists across a scheduled response retry and ends at terminal completion, abort, or a safety timeout. Typing refresh and failure stay outside semantic intent, provider execution, publication evidence, and durable delivery. Gateway heartbeat and resume processing stay outside the ordered provider-work queue so slow answers cannot make subsequent messages disappear.

### Latency profile

The measured pre-change read-response baseline was 19.6–51.4 seconds across seven recent managed runs. A later live message took 56.9 seconds: intent used 13.0 seconds, the first managed response used 14.5 seconds, and a transient evaluator failure caused another complete 12.1-second response run before evaluation and delivery.

Before optional independent evaluation, the installed read responder stores the verified managed result artifact against the exact stable response request digest. The digest excludes the per-attempt decision ID; one process-local single-flight shares identical concurrent requests. Retries after evaluator transport or response-contract failure reuse the immutable CAS artifact without another response-provider invocation. A definitive writing-policy rejection removes the cached coordinate so a later attempt may generate a corrected answer.

The owner-only SQLite mapping stores only the request digest, artifact coordinate, and creation time, retains at most 1,024 records, and rejects conflicting bindings. It copies no message or response body and adds no event. Invalid or conflicting cache state fails response generation rather than selecting unverified bytes.

The latency-oriented installed configuration uses:

- A no-capability, low-effort Claude Haiku intent pass.
- A low-effort GPT-5.6 Sol managed read response.
- No second synchronous publication model.
- High-effort Claude Sonnet 4.6 for repository mutation.

The realtime writing contract retains deterministic publication evidence without claiming independent semantic review. The user selected Codex for reading and Claude for changed execution; authenticated local CLI smoke calls established pinned response and mutation model compatibility.

This deployment profile is not a core default; each hired-agent bot may replace it independently. Live round-trip evidence owns latency claims. Lease renewal, stable artifact reuse, and single-flight remove the observed duplicate provider work. The realtime profile has two sequential model stages for a repository answer and one model stage plus a scoped REST call for a supported platform action. A representative end-to-end latency budget remains open.

### Data boundaries

Raw message text stays in the existing bounded CAS path. Intent input and bounded prior turns are not copied into health, policy, result-correlation, or repository documentation. Context is reconstructed from existing durable interaction records and content hashes, preserving local conversation across Node restarts. Multi-host history replication remains a separate evidence-bound projection.

## Consequences

Operators can speak naturally in configured Discord channels; mentioning the bot does not change semantics. Informational and mutating requests retain separate execution roles, evidence, and failure behavior. Participation, semantic intent, managed reading, signed continuation, deliberation, and platform delivery remain independently replaceable modules.

Live external acceptance requires an unmentioned informational question to produce a provider-generated answer and a natural-language mutation request to enter signed continuation. Mac-offline source transfer remains a separate outcome.

## References

- [Discord-first remote continuation intake](0381-discord-first-remote-continuation-intake.md)
- [Node-hosted Discord conversation service](0382-node-hosted-discord-conversation-service.md)
- [Durable conversation execution result return](0383-durable-conversation-execution-result-return.md)
- [Role-scoped managed conversation responses](../../release/packaging/0047-managed-conversation-responder.md)
- [Cross-provider deliberation runtime](../../execution/providers/0029-cross-provider-deliberation-runtime.md)
- [Distinct Discord identities for hired agents](0385-distinct-discord-agent-identities.md)
