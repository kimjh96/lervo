# ADR-0420: Bind agent conversation and deliberation routes explicitly

- Status: accepted
- Decision date: 2026-09-18
- Amended by: [ADR-0454](0454-open-multi-responder-rooms-and-natural-staffing.md)

## Context

Conversation topology was complete only within one composition boundary: a product owner could delegate to a co-resident child, but cross-Node peers lacked portable display addresses and a shared unaddressed-owner priority. Restart could expose a different default speaker. Formal deliberation exposed policy stakeholder roles without a reviewed contract distinguishing a policy seat from the accepting hired agent's durable role.

Role-name checks, provider compatibility, and same-named Discord webhooks cannot replace these contracts: they conflate conversation ownership, workforce identity, formal responsibility, and delivery authorship.

## Decision

### Use one topology contract for ordinary agent turns

An exact peer binding contains durable participant and agent coordinates, role revision and hashes, tenant and conversation scope, surface principal keys, an optional display address, and reviewed unaddressed priority. Every Node builds the same participant-priority view. Conflicting local and peer values fail startup; role names carry no priority semantics.

Delegation selects the receiver by exact `participantId` and targets its registered runtime. The deployed effect exposes the bounded routable participant catalog; legacy role selection is allowed only when unique. A co-resident receiver owns its CAS write, interaction lifecycle, provider work, and delivery.

Without a local endpoint, the sender publishes one eligible Discord message using the peer's exact bot mention or reviewed `@DisplayName` address. The receiving Node authenticates the peer principal, maps the exact target agent, and starts depth zero only for that agent-to-agent address; other standalone agent messages remain at maximum automation depth. Target-side `policy.acceptsPeerWork` opts an exact peer request into repository work; without it, the turn stays read-only or clarifying. PO-to-worker, worker-to-PO, and worker-to-worker turns share this bounded route without role-derived authority.

For co-resident peers, active workforce role revision and hashes resolved at Node startup supersede an older configured cross-Node snapshot of the same exact agent. Agent, role, speaker, tenant, conversation, display address, and ownership priority must still agree or startup fails. The effective peer list contains the participant once and is shared by identity mapping, turn ownership, and receiver-side delegation validation. A historical static role hash must not reject an otherwise valid current PO-to-worker request after role migration.

Human focus is a separate durable projection. Hiring, delegation, agent results, and restart do not change it. A person changes focus only by exact address or reply; unaddressed priority applies only without retained focus.

### Separate formal policy seats from hired-agent roles

`DeliberationParticipantAssignment` binds one policy ID and policy-role seat to one exact active organization membership, external deployment, channel membership, participant, provider policy, and execution route. The route identifies provider, model, and reasoning effort. Shared deterministic functions generate its route hash and assignment ID; Node acceptance and CLI execution boundaries both recompute them.

`organization.deliberation.participant.bound` version 2 records `policyRoleId`, `agentRoleId`, accepted assignment and execution-route coordinates, provider, and acceptance time. Legacy events remain readable. Any version-2 field requires the complete version-2 coordinate set. Resume requires the same active assignment and route; omission or change fails before another provider turn.

The managed runner retains the policy role ID for deliberation semantics and loads the bound agent's verified role profile. Its actual role name, description, required inputs, context rules, and default skills replace the synthetic seat persona; policy capabilities and handoff constraints remain the upper bound. Work causality records the bound `agentId`. The agent's reviewed model and effort apply only to that seat; semantic evaluators and other seats retain independent routes.

Artifact delivery uses the bound participant's already attached bot or authorized webhook runtime. It never provisions a speaker, copies an application name, or relabels an unbound policy role as an agent. Seats without explicit accepted assignments remain internal policy evidence and produce no visible speaker turn. An unavailable configured-route runtime fails closed instead of creating a binding unable to publish.

Current formal named-agent assignment is repository-local and co-resident. Cross-repository formal participation requires ADR-0421's separately authenticated remote execution protocol; ordinary cross-Node discussion already uses the peer route above.

### Allocate quality by responsibility

Routine repository work uses `routine`; architecture, design, planning, and consequential judgment use `reasoning`; verification, audit, critique, and acceptance use `review`. Formal participant routes may select a stronger model and high effort for specific stakeholder seats without moving all conversation traffic to that route. Actual provider, model, effort, agent causality, and token observations are execution evidence; configuration alone does not prove usage.

Human-facing publication uses the shared managed-context projection. Exact evidence-token comments are recorded as machine evidence and removed before delivery. Empty standalone Markdown HTML comments such as `<!-- -->` are removed, without treating arbitrary nonempty comments as references. Conversation-specific renderers do not append or strip ad hoc suffixes.

## Failure and privacy meaning

Missing, ambiguous, stale, or scope-mismatched peer and participant bindings fail before provider work. Duplicate policy-seat assignments, changed resume routes, unavailable participant runtimes, and zero or multiple artifact publishers are errors. Automation depth is capped at eight.

Canonical events contain only Lervo identities, role and route hashes, provider class, and timestamps. They exclude Discord IDs, credentials, message bodies, prompts, private reasoning, and provider payloads. Native surface identifiers stay in reviewed deployment configuration and adapter state.

## Acceptance

- PO-to-worker, worker-to-PO, and worker-to-worker fixtures execute through the receiver runtime with exact source binding and bounded depth.
- Remote fallback emits one exact address; the receiving identity map recognizes bot and webhook addresses without broad chain-starter authority.
- Nodes with the same peer priorities select one unaddressed owner; conflicting views fail startup.
- Restart retains the human's addressed agent without transferring focus to an assignee or recent publisher.
- A named formal seat preserves distinct policy and workforce roles, rejects route tampering and assignment omission on resume, applies model and effort only to that seat, records agent causality, and publishes exactly once through the bound runtime.
- An unassigned seat stays internal and creates no Discord author, heading, same-named webhook, or agent.
- Ordinary hiring rejects display names already in the routable peer catalog before workforce or Discord mutation. Existing app bots and authorized webhook speakers use their exact participant routes; a display-name match never creates or silently aliases a second speaker.

## Consequences

Conversation topology extends beyond CEO-to-PO and PO-to-PO paths without assigning responsibility through special role strings. Formal deliberation can show real bound agents for reviewed repository-local seats while preserving policy semantics. Cross-repository formal turns require an explicit future protocol rather than an inferred identity claim.

## References

- [ADR-0391](../0391-deterministic-multi-agent-turn-ownership.md)
- [ADR-0393](../0393-named-agent-identity-and-installed-organization-effects.md)
- [ADR-0394](../0394-webhook-backed-discord-agent-identities.md)
- [ADR-0408](../0408-conversation-task-delegation-to-hired-agents.md)
- [ADR-0419](../0419-preserve-human-focus-and-real-agent-authorship.md)
