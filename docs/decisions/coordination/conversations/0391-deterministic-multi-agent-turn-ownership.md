# ADR-0391: Deterministic multi-agent conversation turn ownership

- Status: accepted
- Decision date: 2026-09-09

## Context

Distinct hired-agent bots can independently judge the same unaddressed message relevant. Allowing every bot to respond causes duplicate typing, provider cost, reply storms, and nondeterministic agent-to-agent loops. Recording a non-selected agent as semantically irrelevant creates false evidence. Discord-specific locks would prevent reuse on a future Lervo conversation surface.

## Decision

`@lervo/conversation-contract` resolves response ownership from the Lervo conversation ID and durable participant/role candidates. Role-addressed ties may also use the normalized source-event hash. It never consumes a Discord application ID, channel ID, credential, message body, or provider choice.

Ownership follows these rules:

- Exact participant mentions own their turns.
- A role mention selects one candidate per mentioned role.
- An unaddressed message or subscribed signal selects one stable candidate across the conversation, filtered first by the highest reviewed unaddressed priority. Node composition prioritizes a CEO over ordinary project participants, preventing general conversation from rotating between POs on every message.
- Deterministic rendezvous scoring lets independently deployed bots agree despite different integration and normalized event IDs.
- The source actor is never a candidate for its own turn. An unaddressed agent-authored turn uses the same non-source deterministic owner, followed by semantic relevance; lack of a mention alone does not suppress it. Automation depth, rate limits, cooldown, and effect authorization still bound the exchange.

A unique explicit participant or role address also becomes the deployment's bounded in-memory owner for that conversation and thread. Subsequent unaddressed human turns stay with that interlocutor instead of reverting to the general-channel winner. Each retained turn renews the hold; a gap longer than the reviewed idle interval restores the general unaddressed rule. The idle bound uses normalized event time, not a process clock, so peers reading the same events release the hold identically. Every peer observes the same explicit address and reaches the same sticky choice. Discord normalizes replies to configured bots or webhooks as explicit participant addresses. Restart discards this transient state and safely restores deterministic stable ownership; durable agent and provider context remain unchanged.

`@lervo/interaction` evaluates ownership before relevance, typing, or provider execution. A non-owner commits the existing participation decision with `action: observe`, `reason: turn_not_owned`, and `relevance: not_checked`. This records that another eligible participant owns the response, not a semantic relevance result, delivery result, or execution failure. State retains only existing event, policy, project, conversation, role, decision, and time coordinates. Candidate rosters and scoring inputs are not persisted.

Lervo-owned control replies, status updates, terminal failures, and final-result publications carry the additive `audienceParticipation: observe_only` classification. It describes recipient participation, not authorship, authority, delivery, or semantic correctness. On re-entry through a shared channel, interaction records `action: observe`, `reason: publication_observation_only`, and `relevance: not_checked` before relevance or provider work, even if the publishing agent is otherwise allowed to start an automation chain. A later human reply is a new eligible event, so the boundary does not disable natural follow-up or explicitly addressed agent conversation.

The classification is platform-neutral and contains no message body, principal, credential, or native identifier. A transport must preserve it outside visible prose or fail delivery rather than silently publish an ambiguous automation starter. Native hosts carry the field directly. Discord bot delivery uses a versioned, outbound-derived nonce no longer than Discord's 25-character limit; Gateway and history intake restore the classification only for agent-authored messages with an exact marker. Ordinary and predecessor nonces remain eligible. Discord webhook and Slack delivery currently cannot preserve that lineage and therefore reject an observation-only publication before network use.

The Node composition boundary supplies the current hired-agent participant and only peers bound to the same Lervo conversation. The common contract owns selection, Discord owns external identity mapping, and interaction owns durable observation. Provider adapters remain unaware of group scheduling.

Automatically discovered peer agents do not become automation-chain starters. A deployment must grant that capability through an explicit participant binding; otherwise an unreferenced agent message enters at the terminal automation depth and cannot reset an existing exchange to depth zero. Replies retain depth through the existing message correlation. This keeps natural, reply-bound agent discussion possible while preventing a standalone publication or a message from an older peer runtime from starting an unbounded agent-to-agent loop.

Discord deployments ignore turns containing external mentions when none of those principals resolve locally. They must not erase unresolved addressing and reinterpret the message as unaddressed. A configured peer also discovered as a same-process peer is included once when its durable agent, role, tenant, and speaker coordinates agree. Disagreement fails configuration before duplicate candidates reach turn selection.

## Consequences

Unaddressed human and eligible, explicitly admitted agent messages produce at most one automatic responder per role scope, while explicit participant addressing remains natural. Natural-language deployments evaluate unaddressed human turns by default: ownership establishes eligibility, not a forced response. Non-owning bots, unadmitted standalone peer turns, and recipients of observation-only publications neither show typing indicators nor invoke relevance and response providers. Automation depth, cooldown, hourly limits, self-message suppression, publication classification, and deliberation termination remain independent bounds.

This decision does not provision a second Discord application, create a proactive signal, or grant mutation authority. These remain separate deployment, signal-source, and effect transitions.

## References

- [Platform-neutral conversation participation](0046-platform-neutral-conversation-participation.md)
- [Realtime conversation effects and lifecycle](0388-realtime-conversation-effects-and-lifecycle.md)
- [Role-backed multi-party conversation](../../../roadmap/product-outcome-convergence/host-products/discord/multi-party-conversation.md)
