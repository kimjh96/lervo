# ADR-0386: Organization teams and durable hired-agent identities

- Status: accepted
- Decision date: 2026-09-08

## Context

Lervo already had repository roles, hired agents, assignments, workstreams, provider-neutral deliberation, and distinct Discord bot deployments. It did not define how those parts form one organization with several project teams, or how an agent keeps an identity and context while providers, roles, channels, and assignments change. Treating a role, provider session, participant, or shared bot as the agent would lose responsibility and make multi-agent conversation misleading.

## Decision

Lervo uses the following distinct identities:

- An organization is the policy, budget, and operating boundary that contains central services and project teams.
- A project team owns one repository scope, objectives, workstreams, knowledge, budgets, roster, and conversation spaces. Shiflo and Plen are separate teams even when the same Lervo deployment coordinates both.
- A role is a versioned job and capability contract. It is never a speaker, employee, provider, or channel member.
- A hired agent is a durable expert instance with one agent ID, team membership, exact role binding, reporting relationships, provider policy, lifecycle, and accumulated context.
- A provider and model execute a turn for an agent. Changing Codex, Claude, or a future provider does not replace the agent or transfer its authority.
- A conversation participant is the platform-neutral speaking identity for one agent in a bounded conversation deployment.
- A Discord bot is the external principal for exactly one active hired agent during one immutable deployment binding. A distinct visible agent requires a distinct Discord application, token, guild installation, participant, and integration. Rebinding uses a new deployment identity; historical messages retain the prior agent and role hashes.
- Channel membership is explicit and separate from hiring. Hiring does not claim that Discord installed or admitted the bot, and removing membership does not retire the agent.

The organization may hire a central CEO agent. The human owner or board defines its policy, budget, risk limits, appointment, and removal. Within those limits the CEO may observe teams, propose or create teams, design roles, hire and assign agents, convene discussions, route cross-team work, and use allowlisted Discord administration capabilities such as channel and thread management. Credentials, owner-only approval, security policy, unbounded spending, and high-risk external effects remain separate authorities. A powerful role does not expose bearer tokens or turn a model into the human owner.

Reporting uses explicit scoped relationships rather than one rigid tree. The normal projection is owner or board, CEO agent, team lead or manager agents, and specialist agents. An assignment, handoff, review, or incident may establish a different bounded relationship without changing employment identity.

## Agent context

Every hired agent owns a provider-neutral context namespace keyed by its agent ID. It composes four independently governed layers:

1. identity context: team, exact role contract, responsibility paths, reporting relationships, and provider policy;
2. work context: assignments, workstreams, handoffs, decisions, artifacts, verification, and observed budgets;
3. relationship context: bounded channel, thread, mention, acknowledgement, and deliberation history;
4. accumulated expertise: reviewed decisions, feedback, recurring patterns, and verified improvements attributable to that agent's work.

Canonical repository sources, artifacts, events, and exact decisions remain authoritative. Summaries, search indexes, embeddings, and provider-native sessions are rebuildable projections. Context excludes hidden reasoning, credentials, unrestricted provider payloads, and unreviewed generated claims. Provider replacement preserves the namespace. Role changes append a new exact binding. Retirement makes the context read-only, and a successor receives only an explicit, evidence-bound handoff.

The current Discord runtime preserves agent ID and exact role version, contract hash, and profile hash on platform participant bindings and normalized conversation records. Each bot deployment retains its own durable conversation store, so bounded recent conversation supplied to its responder is agent-specific instead of shared across bot identities. Organization-wide expertise projection and reviewed cross-channel context promotion remain separate delivery work.

## Collaboration and deliberation

Ordinary conversation supports human instructions, agent proposals, mentions, agent-to-agent requests, and acknowledgements. A message does not itself grant repository or external-effect authority. An actionable request enters the existing assignment, workstream, approval, or handoff boundary.

Existing provider-neutral deliberation remains the consensus and evidence core. Lervo does not replace it with an unrelated chat debate engine. Natural conversation may explicitly or by reviewed policy open a bounded discussion that selects agent participants, question, evidence scope, maximum turns, budget, decision rule, and terminal condition. Discord renders those turns through the participants' distinct bot identities. Self-message suppression, automation depth, rate limits, authority checks, and terminal conditions prevent open-ended agent loops.

## Shared infrastructure and isolation

Paperclip-derived organization operations, Buzz-derived conversation routing, Prime-Agent-derived durable execution, and Hermes-derived progressive context and capability disclosure are shared organization infrastructure. Each team consumes those services through its own repository, tenancy, authority, knowledge, budget, roster, and conversation coordinates. Central observation does not merge team state, and cross-team work requires an explicit route, assignment, handoff, or organization policy.

This decision adds no organization event. Future organization, membership, context-promotion, or Discord-administration persistence must define its event name, required coordinates, retention, privacy, authority, and failure meaning before writing durable state.

## Consequences

The system can present agents as stable expert colleagues instead of temporary model invocations. One-to-one bot identity makes Discord authorship honest, while provider-neutral context allows an agent to switch execution providers. Central leadership can coordinate teams without weakening repository-local authority. Real two-agent acceptance still requires a second Discord application, token, installation, and bounded discussion.

## References

- [Distinct Discord identities for hired agents](0385-distinct-discord-agent-identities.md)
- [Provider-neutral deliberation](../../execution/providers/0029-cross-provider-deliberation-runtime.md)
- [Role-backed multi-party conversation](../../../roadmap/product-outcome-convergence/host-products/discord/multi-party-conversation.md)
- [Agent organization delivery](../../../roadmap/product-outcome-convergence/host-products/agent-organization.md)
