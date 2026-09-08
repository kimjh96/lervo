# ADR-0386: Organization teams and durable hired-agent identities

- Status: accepted
- Decision date: 2026-09-08

## Context

Lervo had repository roles, hired agents, assignments, workstreams, provider-neutral deliberation, and distinct Discord bot deployments, but lacked a definition of organization and project teams or continuity of agent identity and context across provider, role, channel, and assignment changes. Equating an agent with a role, provider session, participant, or shared bot would lose responsibility and misrepresent multi-agent conversation.

## Decision

Lervo distinguishes these identities:

- An organization is the policy, budget, and operating boundary containing central services and project teams.
- A project team owns one repository scope, objectives, workstreams, knowledge, budgets, roster, and conversation spaces. Shiflo and Plen remain separate teams in the same Lervo deployment.
- A role is a versioned job and capability contract, never a speaker, employee, provider, or channel member.
- A hired agent is a durable expert instance with one agent ID, team membership, exact role binding, reporting relationships, provider policy, lifecycle, and accumulated context.
- A provider and model execute an agent's turn. Switching Codex, Claude, or a future provider neither replaces the agent nor transfers its authority.
- A conversation participant is one agent's platform-neutral speaking identity in a bounded conversation deployment.
- A Discord bot is the external principal for exactly one active hired agent during one immutable deployment binding. Each distinct visible agent requires a distinct Discord application, token, guild installation, participant, and integration. Rebinding requires a new deployment identity; historical messages retain the prior agent and role hashes.
- Channel membership is explicit and separate from hiring. Hiring implies neither Discord installation nor admission; removing membership does not retire the agent.

The organization may hire a central CEO agent. The human owner or board defines its policy, budget, risk limits, appointment, and removal. Within those limits, the CEO may observe teams, propose or create teams, design roles, hire and assign agents, convene discussions, route cross-team work, and use allowlisted Discord administration capabilities such as channel and thread management. Credentials, owner-only approval, security policy, unbounded spending, and high-risk external effects remain separate authorities. A powerful role neither exposes bearer tokens nor makes a model the human owner.

Reporting uses explicit scoped relationships rather than a rigid tree. The normal projection is owner or board, CEO agent, team lead or manager agents, and specialist agents. Assignments, handoffs, reviews, and incidents may establish different bounded relationships without changing employment identity.

## Agent context

Each hired agent owns a provider-neutral context namespace keyed by agent ID, with four independently governed layers:

1. Identity context: team, exact role contract, responsibility paths, reporting relationships, and provider policy.
2. Work context: assignments, workstreams, handoffs, decisions, artifacts, verification, and observed budgets.
3. Relationship context: bounded channel, thread, mention, acknowledgement, and deliberation history.
4. Accumulated expertise: reviewed decisions, feedback, recurring patterns, and verified improvements attributable to the agent's work.

Canonical repository sources, artifacts, events, and exact decisions remain authoritative. Summaries, search indexes, embeddings, and provider-native sessions are rebuildable projections. Context excludes hidden reasoning, credentials, unrestricted provider payloads, and unreviewed generated claims. Provider replacement preserves the namespace; role changes append a new exact binding. Retirement makes context read-only. Successors receive only explicit, evidence-bound handoffs.

The current Discord runtime preserves agent ID and exact role version, contract hash, and profile hash on platform participant bindings and normalized conversation records. Managed read responses also bind that hired-agent ID to their root work-causality event, attributing provider and model evidence to the speaking agent rather than only a transient execution role. Agent ID participates in response ownership: two agents cannot reuse one response artifact merely because their visible role and source message match. Each bot deployment has a durable conversation store, so bounded recent conversation supplied to its responder is agent-specific rather than shared across bot identities. Organization-wide expertise projection and reviewed cross-channel context promotion remain separate delivery work.

## Collaboration and deliberation

Ordinary conversation supports human instructions, agent proposals, mentions, agent-to-agent requests, acknowledgements, and role-relevant voluntary participation; it is not a deliberation session. The semantic turn record separately decides whether a hired agent has a useful role-specific contribution. An exact participant or role mention addresses that agent without claiming semantic relevance. Recent context preserves every speaker's human, system, participant, agent, and role coordinates so peer turns do not become an anonymous user transcript. Messages do not themselves grant repository or external-effect authority. Actionable requests enter the existing assignment, workstream, approval, or handoff boundary.

Existing provider-neutral deliberation remains the consensus and evidence core; Lervo does not replace it with an unrelated chat debate engine. Natural conversation may, explicitly or by reviewed policy, open a bounded discussion selecting agent participants, question, evidence scope, maximum turns, budget, decision rule, and terminal condition. Discord renders turns through participants' distinct bot identities. Self-message suppression, automation depth, rate limits, authority checks, and terminal conditions prevent open-ended agent loops.

## Shared infrastructure and isolation

Paperclip-derived organization operations, Buzz-derived conversation routing, Prime-Agent-derived durable execution, and Hermes-derived progressive context and capability disclosure are shared organization infrastructure. Each team consumes them through its own repository, tenancy, authority, knowledge, budget, roster, and conversation coordinates. Central observation does not merge team state. Cross-team work requires an explicit route, assignment, handoff, or organization policy.

Repository-local organization state is append-only event history:

- `organization.team.bound` binds one repository identity to one project team.
- `organization.agent.membership.changed` preserves exact agent, role, provider-policy, lifecycle, and revision coordinates.
- `organization.external_agent.deployment.bound` and `.retired` preserve the one-to-one external principal lifecycle.
- `organization.channel.membership.changed` preserves explicit admission and departure.
- `organization.deliberation.participant.bound` and `.released` bind bounded discussion participation and its terminal outcome to the same identities.

Raw Discord application, guild, and channel IDs remain deployment configuration. Organization events retain only stable hashes of external principals and coordinates plus Lervo IDs; credentials, display names, messages, prompts, and provider-native session IDs are excluded. A repository team binding is immutable. Membership, channel, deployment, and deliberation transitions fail closed on stale revisions, mismatched role hashes, duplicate active principals, missing active parents, or invalid lifecycle order.

`lervo organization bind-runtime` is the explicit owner-authorized transition deriving these bindings from current hired-agent and Node configuration. A Node deployment with `discordConversation.organization` replays organization history at startup and refuses to start unless repository identity, team, agent, exact role, provider policy, external principal, deployment configuration, and every configured channel match. Omitting that block preserves backward-compatible standalone deployments without claiming organization membership.

## Consequences

Agents can appear as stable expert colleagues rather than temporary model invocations. One-to-one bot identity makes Discord authorship honest; provider-neutral context supports execution-provider changes. Central leadership can coordinate teams without weakening repository-local authority. The durable repository-local identity projection is implemented; central administration and real two-agent acceptance still require a second Discord application, token, installation, and bounded discussion.

## References

- [Distinct Discord identities for hired agents](0385-distinct-discord-agent-identities.md)
- [Provider-neutral deliberation](../../execution/providers/0029-cross-provider-deliberation-runtime.md)
- [Role-backed multi-party conversation](../../../roadmap/product-outcome-convergence/host-products/discord/multi-party-conversation.md)
- [Agent organization delivery](../../../roadmap/product-outcome-convergence/host-products/agent-organization.md)
