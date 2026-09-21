# ADR-0420: Bind agent conversation and deliberation routes explicitly

- Status: accepted
- Decision date: 2026-09-18

## Context

Conversation topology was only complete inside one composition boundary. A product owner could delegate to a co-resident child, but a peer on another Node lacked a portable display address and every Node did not necessarily share the same unaddressed-owner priority. A restart could therefore expose a different default speaker. Formal deliberation had the opposite identity problem: policy stakeholder roles were visible, but there was no reviewed contract separating a policy seat from the durable role of the hired agent accepting that seat.

Role-name checks, provider compatibility, and same-named Discord webhooks are not valid substitutes for either contract. They conflate conversation ownership, workforce identity, formal responsibility, and delivery authorship.

## Decision

### Use one topology contract for ordinary agent turns

An exact peer binding contains the durable participant and agent coordinates, role revision and hashes, tenant and conversation scope, surface principal keys, optional display address, and reviewed unaddressed priority. Every Node builds the same participant-priority view. Conflicting local and peer values fail startup; role names have no priority semantics.

Delegation first selects the receiver by its exact `participantId`, not its role name, and targets that registered runtime. The deployed effect exposes the bounded routable participant catalog; legacy role selection is accepted only when it is unique. A co-resident receiver owns its CAS write, interaction lifecycle, provider work, and delivery. If no local endpoint exists, the sender publishes one eligible Discord message with the peer's exact bot mention or reviewed `@DisplayName` address. The receiving Node authenticates the peer principal, maps the exact target agent, starts depth zero only for that agent-to-agent address, and otherwise leaves standalone agent messages at the maximum automation depth. `policy.acceptsPeerWork` is the target-side opt-in that lets such an exact peer request repository work; without it the turn remains read-only or clarifying. PO-to-worker, worker-to-PO, and worker-to-worker turns therefore use the same bounded route without deriving authority from a role name.

For co-resident peers, the active workforce role revision and hashes resolved at Node startup supersede an older configured cross-Node peer snapshot of the same exact agent. The configuration must still agree on the agent, role, speaker, tenant, conversation, display address, and ownership priority; those mismatches fail startup. The effective peer list contains that participant once and is shared by identity mapping, turn ownership, and receiver-side delegation validation. A historical static role hash must not make a current, otherwise valid PO-to-worker request fail after role migration.

Human focus remains a separate durable projection. Hiring, delegation, agent results, and restart do not change it. A person changes focus only by an exact address or reply, and unaddressed priority applies only when no retained focus exists.

### Separate formal policy seats from hired-agent roles

`DeliberationParticipantAssignment` binds one policy ID and policy-role seat to one exact active organization membership, external deployment, channel membership, participant, provider policy, and execution route. The route identifies provider, model, and reasoning effort. Shared deterministic functions produce its route hash and assignment ID; both the Node acceptance boundary and CLI execution boundary recompute them.

`organization.deliberation.participant.bound` version 2 records both `policyRoleId` and `agentRoleId`, the accepted assignment and execution-route coordinates, provider, and acceptance time. Legacy events remain readable. A version-2 field without the complete version-2 coordinate set is invalid. Resume requires the same active assignment and route; omitting or changing it fails before another provider turn.

The managed runner keeps the policy role ID for deliberation semantics while loading the bound agent's verified role profile. The actual role name, description, required inputs, context rules, and default skills replace the synthetic seat persona; policy capabilities and handoff constraints remain the upper bound. Work causality records the bound `agentId`, and the agent's reviewed model and effort apply only to that policy seat. Semantic evaluators and other seats retain their independent routes. Artifact delivery uses the already attached bot or authorized webhook runtime for the bound participant. It never provisions a speaker, copies an application name, or relabels an unbound policy role as an agent.

Seats without an explicit accepted assignment remain internal policy evidence and produce no visible speaker turn. A configured route whose runtime is unavailable fails closed instead of creating a binding that cannot publish. Current formal named-agent assignment is repository-local and co-resident; cross-repository formal participation requires the separately authenticated remote execution protocol in ADR-0421. Cross-Node ordinary discussion already uses the peer route above.

### Allocate quality by responsibility

Routine repository work uses the existing `routine` execution profile. Architecture, design, planning, and consequential judgment use `reasoning`; verification, audit, critique, and acceptance use `review`. Formal participant routes may select a stronger model and high effort for specific stakeholder seats without moving all conversation traffic to that route. Actual provider, model, effort, agent causality, and token observations remain execution evidence; configuration alone is not a usage claim.

Human-facing publication uses the shared managed-context projection. Exact evidence-token comments are recorded as machine evidence and removed before delivery, and empty standalone Markdown HTML comments such as `<!-- -->` are removed without treating arbitrary nonempty comments as references. Conversation-specific renderers do not append or strip ad hoc suffixes.

## Failure and privacy meaning

Missing, ambiguous, stale, or scope-mismatched peer and participant bindings fail before provider work. Duplicate policy-seat assignments, changed resume routes, unavailable participant runtimes, and zero or multiple artifact publishers are errors. Automation depth remains capped at eight.

Canonical events contain only Lervo identities, role and route hashes, provider class, and timestamps. They exclude Discord IDs, credentials, message bodies, prompts, private reasoning, and provider payloads. Native surface identifiers remain in reviewed deployment configuration and adapter state.

## Acceptance

- PO-to-worker, worker-to-PO, and worker-to-worker fixtures execute through the receiver runtime with exact source binding and bounded depth.
- A remote peer fallback emits one exact address; the receiving identity map recognizes bot and webhook addresses without broad chain-starter authority.
- All Nodes supplied the same peer priorities select one unaddressed owner; conflicting views fail startup.
- Restart retains the human's addressed agent and does not transfer focus to an assignee or recent publisher.
- A named formal seat preserves distinct policy and workforce roles, rejects route tampering and assignment omission on resume, applies its model and effort only to that seat, records agent causality, and publishes through the bound runtime exactly once.
- An unassigned seat remains internal and creates no Discord author, heading, same-named webhook, or agent.
- Ordinary hiring likewise rejects a display name already present in the routable peer catalog before workforce or Discord mutation. Existing app bots and authorized webhook speakers are addressed by their exact participant route; a display-name match never creates or silently aliases a second speaker.

## Consequences

Conversation topology is no longer limited to CEO-to-PO or PO-to-PO paths, and responsibility does not depend on special role strings. Formal deliberation can show a real bound agent for reviewed repository-local seats while preserving policy semantics. Cross-repository formal turns remain an explicit future protocol rather than an inferred identity claim.

## References

- [ADR-0391](../0391-deterministic-multi-agent-turn-ownership.md)
- [ADR-0393](../0393-named-agent-identity-and-installed-organization-effects.md)
- [ADR-0394](../0394-webhook-backed-discord-agent-identities.md)
- [ADR-0408](../0408-conversation-task-delegation-to-hired-agents.md)
- [ADR-0419](../0419-preserve-human-focus-and-real-agent-authorship.md)
