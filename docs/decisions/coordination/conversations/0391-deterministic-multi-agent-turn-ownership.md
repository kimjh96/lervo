# ADR-0391: Deterministic multi-agent conversation turn ownership

- Status: accepted
- Decision date: 2026-09-09

## Context

Distinct hired-agent bots can independently find the same unaddressed message relevant. Letting all respond causes duplicate typing, provider cost, reply storms, and nondeterministic agent-to-agent loops. Recording non-selected agents as semantically irrelevant creates false evidence. Discord-specific locks would prevent reuse on future Lervo conversation surfaces.

## Decision

### Ownership selection

`@lervo/conversation-contract` resolves response ownership from the Lervo conversation ID and durable participant/role candidates. Role-addressed ties may also use the normalized source-event hash. Selection never consumes a Discord application ID, channel ID, credential, message body, or provider choice.

- Exact participant mentions own their turns.
- A role mention selects one candidate per mentioned role.
- An unaddressed message or subscribed signal selects one stable candidate across the conversation after filtering by the highest reviewed unaddressed priority. Local deployments and cross-Node peer bindings carry the same explicit priority. An optional per-conversation override supports a participant that owns General but only mediates when addressed in a project channel. Role names have no scheduling meaning. Conflicting views for the same participant and conversation fail startup.
- Deterministic rendezvous scoring lets independently deployed bots agree despite different integration and normalized event IDs.
- The source actor is never a candidate for its own turn. Before relevance, an ordinary agent-authored turn must resolve to exactly one explicitly addressed participant or role; unaddressed turns and ambiguous fan-out are observed. A versioned coordination envelope may name several exact participants for a bounded discussion assignment or return one authenticated delegated-task result to its exact coordinator. Automation depth, rate limits, cooldown, and effect authorization still bound the exchange.

Protocol ownership is compositional: an evaluator decides only coordination kinds it owns. An unrelated authenticated kind falls through to its own evaluator or the ordinary exact-address ladder, rather than being rejected as an invalid instance of another protocol. Natural-discussion ownership handles assignments, contributions, and durable deadline decisions. Delegated-task assignments use ordinary exact target ownership; results use their authenticated exact coordinator. Only the stored discussion source named in a system event owns its discussion deadline. It claims the deadline once before synthesis, preventing repeated deadline events from an unowned due record.

### Durable human focus

A unique explicit participant or role address from a human establishes the bounded durable interlocutor for that conversation and thread. Subsequent unaddressed human turns stay with that interlocutor instead of reverting to the general-channel winner. Hiring, assignment, provider selection, agent-authored messages, and runtime reconfiguration do not change this focus.

Each retained human turn renews the hold. A gap longer than the reviewed idle interval releases it to the general unaddressed rule. The interval uses normalized event time, not a process clock, so peers reading the same events release focus identically. Every peer observes the same explicit address and reaches the same sticky choice. Discord normalizes replies to configured bots or webhooks as explicit participant addresses.

Restart and candidate-roster changes recover durable focus. If the focused participant is no longer eligible, the state is removed and the deterministic unaddressed rule selects exactly one current owner.

The installed Node stores `conversation_turn_focus.v1`, a bounded, surface-neutral projection shared by co-resident deployments. Each record requires project, conversation, nullable thread, focused participant, latest normalized event time, and source-event-key hash. It contains no message body, native platform identifier, agent provider, model, credential, assignment, or repository authority.

Updates are monotonic by event time and source hash; exact replay is idempotent. Retention is capped at 1,024 scopes. Corrupt, unsupported, symlinked, or unavailable state fails Node startup or turn ownership closed before relevance, typing, or provider execution. A later cross-Node host can supply this projection rebuilt from canonical conversation history. It is neither agent memory nor task ownership.

### Interaction and publication boundaries

`@lervo/interaction` evaluates ownership before relevance, typing, or provider execution. A non-owner commits the existing participation decision with `action: observe`, `reason: turn_not_owned`, and `relevance: not_checked`. This records that another eligible participant owns the response; it is not a semantic relevance result, delivery result, or execution failure.

Interaction state retains only the existing event, policy, project, conversation, role, decision, and time coordinates. The separate bounded focus projection retains only its specified fields. Candidate rosters and scoring inputs are not persisted.

Lervo-owned control replies, status updates, terminal failures, and final-result publications carry the additive `audienceParticipation: observe_only` classification. It describes recipient participation, not authorship, authority, delivery, or semantic correctness. On shared-channel re-entry, interaction records `action: observe`, `reason: publication_observation_only`, and `relevance: not_checked` before relevance or provider work, even if the publishing agent may otherwise start an automation chain. A later human reply is a new eligible event, preserving natural follow-up and explicitly addressed agent conversation.

The classification is platform-neutral and contains no message body, principal, credential, or native identifier. Transports must preserve it outside visible prose or fail delivery rather than silently publish an ambiguous automation starter. Native hosts carry the field directly. Discord bot delivery uses a versioned, outbound-derived nonce within Discord's 25-character limit. Gateway and history intake restore the classification only for agent-authored messages with an exact marker; ordinary and predecessor nonces remain eligible. Discord webhook and Slack delivery currently cannot preserve this lineage and reject observation-only publications before network use.

### Composition and Discord addressing

The Node composition boundary supplies the current hired-agent participant and only peers bound to the same Lervo conversation. The common contract owns selection, Discord owns external identity mapping, and interaction owns durable observation. Provider adapters remain unaware of group scheduling.

Automatically discovered peers do not become automation-chain starters. A deployment must grant that capability through an explicit participant binding. Otherwise, an unreferenced agent message enters at terminal automation depth and cannot reset an existing exchange to depth zero. Replies retain depth through existing message correlation. This permits natural, reply-bound agent discussion while preventing standalone publications or messages from older peer runtimes from starting unbounded agent-to-agent loops.

Discord deployments ignore turns with external mentions when none of those principals resolve locally. They must not erase unresolved addressing and reinterpret the message as unaddressed. A configured peer also discovered in the same process is included once when its durable agent, role, tenant, and speaker coordinates agree. Disagreement fails configuration before duplicate candidates reach selection.

Discord's native `@BotName` picker may emit a bot's managed role (`mention_roles` and `<@&roleId>`) instead of a user mention. The adapter verifies the role against the authenticated guild's role list and its `managed: true`/`tags.bot_id` relation, then maps the bot ID through the existing participant binding. Role names are not identity evidence. Ordinary, unknown, or unverifiable role addresses remain explicitly unresolved and never become unaddressed turns for another bot. This mapping changes only conversation addressing and grants no repository or deployment authority.

## Consequences

Unaddressed human and eligible, explicitly admitted agent messages produce at most one automatic responder per role scope, while explicit participant addressing remains natural. Natural-language deployments evaluate unaddressed human turns by default: ownership establishes eligibility, not a forced response.

Non-owning bots, unadmitted standalone peer turns, and recipients of observation-only publications neither show typing indicators nor invoke relevance and response providers. Automation depth, cooldown, hourly limits, self-message suppression, publication classification, and deliberation termination remain independent bounds.

This decision does not provision a second Discord application, create a proactive signal, or grant mutation authority. Those remain separate deployment, signal-source, and effect transitions.

## References

- [Platform-neutral conversation participation](0046-platform-neutral-conversation-participation.md)
- [Realtime conversation effects and lifecycle](0388-realtime-conversation-effects-and-lifecycle.md)
- [Role-backed multi-party conversation](../../../roadmap/product-outcome-convergence/host-products/discord/multi-party-conversation.md)
