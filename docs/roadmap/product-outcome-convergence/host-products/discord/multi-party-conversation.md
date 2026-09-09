# Role-backed multi-party conversation

Part of [Discord remote continuation](../discord.md).

State: `delivery required`.

## Participant binding

Each hired agent instance is a participant; its role template is not. Its unique display name is separate from its role: `CEO`, `developer`, or another role label is never synthesized as its name. Channel membership binds durable participant ID, agent ID, exact role ID and version or hash, repository scope, active lifecycle state, and provider policy. Workforce policy permits fixed `codex` or `claude` providers, or `any` for policy-driven selection. Each turn records its provider and model, preserving responsibility when agents share roles or are replaced or retired.

A Discord speaker principal is a hired agent's one-to-one external identity for an immutable deployment binding: a bot user or exact channel-to-webhook set. Hiring, Gateway installation, webhook preparation, channel membership, provider selection, and execution authority are separate transitions. Each deployment retains agent-specific durable conversation history. Broader expertise follows the source-bound context lifecycle in [ADR-0386](../../../../decisions/coordination/conversations/0386-organization-teams-and-agent-identities.md).

## Channel composition

Channels may contain people and multiple hired agents with different roles. Messages may address a participant, agent, role, or bounded deliberation group. Policy resolves `@role` to eligible active agent participants without making role definitions actors or granting execution authority. Every resulting turn retains speaker, addressee, thread or deliberation ID, role binding, automation depth, and evidence coordinates.

## Constraints

- Human and agent turns share natural-language intent and per-agent participation resolution.
- Every eligible unaddressed human message has one deterministic owner in conversational deployments; semantic participation failure cannot silently discard it.
- Agent-authored discussion is read-only by default.
- Uncorrelated agent messages start at maximum automation depth unless an exact reviewed participant binding designates the coordinating agent as a chain starter. This grants no effect authority.
- Agent-authored continuation and platform effects require a separate exact participant, role, tenant, and conversation opt-in, then retain existing signed command and allowlisted-effect boundaries.
- Repository mutation, external effects, assignment changes, and approval resolution require existing authority paths.
- Participation policies, maximum automation depth, response budgets, explicit deliberation termination, and self-message suppression must prevent agent reply loops.

Read-only discussion includes requested repository inspection and bounded code excerpts. Repository changes enter managed continuation with the same Codex and Claude adapter capabilities, authority, snapshots, verification, evidence, and result return used outside Discord.

Agents may create allowed threads, reply, and mention participants when conversation and organization policy permit. These surface actions remain distinct from repository authority. Native reply projection is selected per turn only when it clarifies a concurrent or explicit reply relationship. Ordinary sequential answers remain standalone rather than automatically replying to every source message.

## Automatic provider selection

Selection evaluates the hired agent's provider policy, exact role capabilities, provider availability, and configured cost and latency budgets. It records provider, model, selection policy version, and reason, and fails closed when no candidate satisfies the constraints. Provider choice never changes role or assignment authority.

## Current scope

The installed Node accepts a bounded collection of distinct Discord agent deployments. Bot speakers use one application each. Webhook speakers may share the exact Gateway application and bot credential while retaining distinct webhook IDs, owner-only webhook tokens, hired-agent bindings, current role hashes, provider and model routing, storage, response ownership, and delivery adapters. Every owned agent turn loads that agent's reviewed context through the managed context coordinator used for repository search and evidence.

Shared-guild peer author and mention aliases normalize to the peer's single workforce participant. Before semantic relevance, deterministic turn ownership assigns exact participant mentions to their addressees, selects one participant per mentioned role, and selects one participant for an unaddressed message or signal. Non-owners record `turn_not_owned` without typing or provider work. Owners still need explicit addressing or a distinct role-relevant contribution. Bounded recent context retains the speaker's participant, agent, and role identity. Aggregate readiness and failure remain fail-closed.

Installed Node deployments can map bounded canonical repository event types to proactive signals and run explicit cross-provider deliberation through the durable queue. Both preserve deterministic turn ownership, managed retrieval, provider budgets, repository verification, CAS, and event evidence. Discord is only the current transport.

The installed executive boundary executes hash-bound, allowlisted Discord text-channel and public-thread effects with durable replay and fail-closed uncertainty. The installed deliberation worker reconciles uncertain outcomes from canonical CLI evidence and publishes a bounded visible result through the managed conversation path.

Implemented capabilities:

- Webhook-backed delivery.
- Same-Node and explicitly bound cross-Node peer-author normalization.
- Shared-Gateway validation and replay-safe executive webhook preparation.
- Authenticated parent/thread resolution and native thread delivery.
- Bot-native replies and source-message reply correlation.
- Natural allowlisted text-channel and current-channel public-thread creation.

Webhook replies remain canonical rather than native. Remaining work includes invoking agent-deployment preparation and runtime binding from natural CEO conversation, broader natural addressed groups, and the required real two-agent discussion. Each agent needing native Discord member presence, its own typing indicator, or native mentionability requires a separate installed bot application; webhook identities cannot provide these capabilities.

## Acceptance

One real channel with one person and at least two hired agents in distinct roles must:

- Inspect requested code and complete authorized real work.
- Use threads, replies, and mentions as needed.
- Complete a bounded discussion and stop at its declared terminal condition.
- Preserve every participant, role, provider-model, and agent-context coordinate across restart.
- Produce no unauthorized repository or external effect.

The same scenario must be replayable through a non-Discord test surface over shared application contracts.

## References

- [ADR-0384](../../../../decisions/coordination/conversations/0384-explicit-discord-read-and-continuation-modes.md)
- [ADR-0385](../../../../decisions/coordination/conversations/0385-distinct-discord-agent-identities.md)
- [ADR-0386](../../../../decisions/coordination/conversations/0386-organization-teams-and-agent-identities.md)
- [ADR-0387](../../../../decisions/coordination/conversations/0387-terminal-conversation-response-failures.md)
- [ADR-0391](../../../../decisions/coordination/conversations/0391-deterministic-multi-agent-turn-ownership.md)
- [ADR-0392](../../../../decisions/coordination/conversations/0392-installed-proactive-signals-and-deliberation.md)
- [ADR-0393](../../../../decisions/coordination/conversations/0393-named-agent-identity-and-installed-organization-effects.md)
- [ADR-0394](../../../../decisions/coordination/conversations/0394-webhook-backed-discord-agent-identities.md)
- [Cross-provider deliberation runtime](../../../../decisions/execution/providers/0029-cross-provider-deliberation-runtime.md)
