# ADR-0386: Organization teams and durable hired-agent identities

- Status: accepted
- Decision date: 2026-09-08

## Context

Lervo already had repository roles, hired agents, assignments, workstreams, provider-neutral deliberation, and distinct Discord bot deployments, but no definition of how they form an organization with project teams or preserve agent identity and context across provider, role, channel, and assignment changes. Equating an agent with a role, provider session, participant, or shared bot would lose responsibility and misrepresent multi-agent conversation.

## Decision

Lervo distinguishes these identities:

- An organization is the policy, budget, and operating boundary containing central services and project teams.
- A project team owns one repository scope, objectives, workstreams, knowledge, budgets, roster, and conversation spaces. Shiflo and Plen remain separate teams within the same Lervo deployment.
- A role is a versioned job and capability contract, never a speaker, employee, provider, or channel member.
- A hired agent is a durable expert instance with one agent ID, team membership, exact role binding, reporting relationships, provider policy, lifecycle, and accumulated context.
- A provider and model execute a turn for an agent. Switching Codex, Claude, or a future provider neither replaces the agent nor transfers its authority.
- A conversation participant is the platform-neutral speaking identity for one agent in a bounded conversation deployment.
- A Discord bot is the external principal for exactly one active hired agent during one immutable deployment binding. Each distinct visible agent requires a distinct Discord application, token, guild installation, participant, and integration. Rebinding requires a new deployment identity; historical messages retain the prior agent and role hashes.
- Channel membership is explicit and separate from hiring. Hiring does not imply Discord installation or admission; removing membership does not retire the agent.

The organization may hire a central CEO agent. The human owner or board defines its policy, budget, risk limits, appointment, and removal. Within those limits, the CEO may observe teams, propose or create teams, design roles, hire and assign agents, convene discussions, route cross-team work, and use allowlisted Discord administration capabilities such as channel and thread management. Credentials, owner-only approval, security policy, unbounded spending, and high-risk external effects remain separate authorities. A powerful role neither exposes bearer tokens nor makes a model the human owner.

Reporting uses explicit scoped relationships, not one rigid tree. The normal projection is owner or board, CEO agent, team lead or manager agents, and specialist agents. Assignments, handoffs, reviews, and incidents may establish different bounded relationships without changing employment identity.

## Agent context

Each hired agent owns a provider-neutral context namespace keyed by agent ID, composed of four independently governed layers:

1. Identity context: team, exact role contract, responsibility paths, reporting relationships, and provider policy.
2. Work context: assignments, workstreams, handoffs, decisions, artifacts, verification, and observed budgets.
3. Relationship context: bounded channel, thread, mention, acknowledgement, and deliberation history.
4. Accumulated expertise: reviewed decisions, feedback, recurring patterns, and verified improvements attributable to the agent's work.

Canonical repository sources, artifacts, events, and exact decisions remain authoritative. Summaries, search indexes, embeddings, and provider-native sessions are rebuildable projections. Context excludes hidden reasoning, credentials, unrestricted provider payloads, and unreviewed generated claims. Provider replacement preserves the namespace; role changes append a new exact binding. Retirement makes context read-only. Successors receive only explicit, evidence-bound handoffs.

The current Discord runtime preserves agent ID and exact role version, contract hash, and profile hash on platform participant bindings and normalized conversation records. Each bot deployment has its own durable conversation store, making bounded recent conversation supplied to its responder agent-specific rather than shared across bot identities. Organization-wide expertise projection and reviewed cross-channel context promotion remain separate delivery work.

## Collaboration and deliberation

Ordinary conversation supports human instructions, agent proposals, mentions, agent-to-agent requests, and acknowledgements. Messages do not themselves grant repository or external-effect authority. Actionable requests enter the existing assignment, workstream, approval, or handoff boundary.

Existing provider-neutral deliberation remains the consensus and evidence core; Lervo does not replace it with an unrelated chat debate engine. Natural conversation may, explicitly or by reviewed policy, open a bounded discussion selecting agent participants, question, evidence scope, maximum turns, budget, decision rule, and terminal condition. Discord renders turns through participants' distinct bot identities. Self-message suppression, automation depth, rate limits, authority checks, and terminal conditions prevent open-ended agent loops.

## Shared infrastructure and isolation

Paperclip-derived organization operations, Buzz-derived conversation routing, Prime-Agent-derived durable execution, and Hermes-derived progressive context and capability disclosure are shared organization infrastructure. Each team consumes them through its own repository, tenancy, authority, knowledge, budget, roster, and conversation coordinates. Central observation does not merge team state. Cross-team work requires an explicit route, assignment, handoff, or organization policy.

This decision adds no organization event. Before writing durable state, future organization, membership, context-promotion, or Discord-administration persistence must define its event name, required coordinates, retention, privacy, authority, and failure meaning.

## Consequences

Agents can appear as stable expert colleagues rather than temporary model invocations. One-to-one bot identity makes Discord authorship honest; provider-neutral context supports execution-provider changes. Central leadership can coordinate teams without weakening repository-local authority. Real two-agent acceptance still requires a second Discord application, token, installation, and bounded discussion.

## References

- [Distinct Discord identities for hired agents](0385-distinct-discord-agent-identities.md)
- [Provider-neutral deliberation](../../execution/providers/0029-cross-provider-deliberation-runtime.md)
- [Role-backed multi-party conversation](../../../roadmap/product-outcome-convergence/host-products/discord/multi-party-conversation.md)
- [Agent organization delivery](../../../roadmap/product-outcome-convergence/host-products/agent-organization.md)
