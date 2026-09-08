# Role-backed multi-party conversation

Part of [Discord remote continuation](../discord.md).

State: `delivery required`.

## Participant binding

Each hired agent instance, not its role template, is a conversation participant. Channel membership binds its durable participant ID, agent ID, exact role ID and version or hash, repository scope, active lifecycle state, and provider policy. The workforce contract permits fixed `codex` or `claude` providers or `any` for policy-driven selection. Each turn records its selected provider and model, preserving responsibility when agents share a role or an agent is replaced or retired.

A Discord bot is the hired agent's one-to-one external identity for an immutable deployment binding. Hiring, guild installation, channel membership, provider selection, and execution authority remain separate transitions. Each deployment retains durable agent-specific conversation history. Broader accumulated expertise follows the source-bound context lifecycle in [ADR-0386](../../../../decisions/coordination/conversations/0386-organization-teams-and-agent-identities.md).

## Channel composition

A channel may contain people and multiple hired agents with different roles. Messages may address a participant, agent, role, or bounded deliberation group. Policy resolves `@role` to eligible active agent participants; it neither makes the role definition an actor nor grants execution authority. Every resulting turn retains speaker, addressee, thread or deliberation ID, role binding, automation depth, and evidence coordinates.

## Constraints

- Human and agent turns share natural-language intent and per-agent participation resolution.
- Agent-authored discussion is read-only by default.
- Repository mutation, external effects, assignment changes, and approval resolution require their existing authority paths.
- Participation policies, maximum automation depth, response budgets, explicit deliberation termination, and self-message suppression must prevent agent reply loops.

## Automatic provider selection

Selection must evaluate the hired agent's provider policy, exact role capabilities, provider availability, and configured cost and latency budgets. It must record the selected provider, model, selection policy version, and reason, and fail closed when no candidate satisfies those constraints. Provider choice never changes role or assignment authority.

## Current scope

The installed Node accepts a bounded collection of distinct Discord bot applications. Each bot binds one active hired agent, exact current role hashes, independent provider and model routing, owner-only credentials, storage, Gateway lifecycle, and delivery adapter. Every owned agent turn loads that agent's reviewed context through the managed context coordinator used for repository search and evidence.

Shared-guild peer author and mention aliases normalize to that peer's one workforce participant. Before semantic relevance, deterministic turn ownership assigns exact participant mentions to their addressees, selects one participant per mentioned role, and selects one participant for an unaddressed message or signal. Non-owners record `turn_not_owned` without typing or provider work. An owning agent still needs explicit addressing or a distinct role-relevant contribution. Bounded recent context retains the speaker's participant, agent, and role identity. Aggregate readiness and failure remain fail-closed.

Remaining work includes Discord application creation, token issuance, guild installation, proactive initiative sources, CEO administration effect wiring, and the required real two-agent discussion. Discord cannot create a separately authenticated application or grant its own installation; this external authority remains explicit rather than simulated.

## Acceptance

One real channel with one person and at least two hired agents in distinct roles must complete a bounded discussion, preserve every participant and role coordinate, stop at its declared terminal condition, and produce no unauthorized repository or external effect.

## References

- [ADR-0384](../../../../decisions/coordination/conversations/0384-explicit-discord-read-and-continuation-modes.md)
- [ADR-0385](../../../../decisions/coordination/conversations/0385-distinct-discord-agent-identities.md)
- [ADR-0386](../../../../decisions/coordination/conversations/0386-organization-teams-and-agent-identities.md)
- [ADR-0387](../../../../decisions/coordination/conversations/0387-terminal-conversation-response-failures.md)
- [ADR-0391](../../../../decisions/coordination/conversations/0391-deterministic-multi-agent-turn-ownership.md)
- [Cross-provider deliberation runtime](../../../../decisions/execution/providers/0029-cross-provider-deliberation-runtime.md)
