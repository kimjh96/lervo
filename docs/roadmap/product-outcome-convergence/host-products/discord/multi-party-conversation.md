# Role-backed multi-party conversation

Part of [Discord remote continuation](../discord.md).

State: `installed acceptance required`.

## Participant binding

Each hired agent instance is a participant; its role template is not. Its unique display name is separate from its role: `CEO`, `developer`, and other role labels are never synthesized as names. Channel membership binds durable participant ID, agent ID, exact role ID and version or hash, repository scope, active lifecycle state, and provider policy. Workforce policy permits fixed `codex` or `claude` providers, or `any` for policy-driven selection. Every turn records provider and model, preserving responsibility when agents share roles, are replaced, or retire.

A Discord speaker principal is a hired agent's one-to-one external identity for an immutable deployment binding: a bot user or exact channel-to-webhook set. Hiring, Gateway installation, webhook preparation, channel membership, provider selection, and execution authority are separate transitions. Each deployment retains agent-specific durable conversation history. Broader expertise follows the source-bound context lifecycle in [ADR-0386](../../../../decisions/coordination/conversations/0386-organization-teams-and-agent-identities.md).

## Channel composition

Channels may contain people and multiple hired agents with different roles. Messages may address a participant, agent, role, or bounded deliberation group. Policy resolves `@role` to eligible active agent participants without making role definitions actors or granting execution authority. Every resulting turn retains speaker, addressee, thread or deliberation ID, role binding, automation depth, and evidence coordinates.

## Constraints

- Human and agent turns share natural-language intent and per-agent participation resolution.
- Every eligible unaddressed human message has one deterministic owner in conversational deployments; semantic participation failure cannot silently discard it.
- A deployment ignores messages containing Discord mentions it cannot map. It must not reclassify them as unaddressed and let an unrelated stable owner answer for the missing addressee.
- Agent-authored discussion is read-only by default.
- Unbound agent messages start at maximum automation depth. Exact reviewed peer agents may start at depth zero. Every agent-to-agent response uses reply correlation so separate integrations advance the same depth and stop at the configured maximum. This grants no effect authority.
- Agent-authored continuation and platform effects require a separate exact participant, role, tenant, and conversation opt-in, retaining existing signed command and allowlisted-effect boundaries.
- Repository mutation, external effects, assignment changes, and approval resolution require existing authority paths.
- Participation policies, maximum automation depth, response budgets, explicit deliberation termination, and self-message suppression must prevent agent reply loops.

Read-only discussion includes requested repository inspection and bounded code excerpts. Natural repository work enters a resumable native Codex or Claude tool session on the repository Node, recording durable session and result coordinates and Git-observed changes without manufacturing exact-path managed-run evidence. Exact-path reviewed changes may still use managed continuation.

Agents may create allowed threads, reply, and mention participants when conversation and organization policy permit. These surface actions are distinct from repository authority. Native reply projection is selected per turn only when it clarifies a concurrent or explicit reply relationship. Ordinary sequential answers remain standalone rather than automatically replying to every source message.

## Automatic provider selection

Selection evaluates the hired agent's provider policy, exact role capabilities, provider availability, and configured cost and latency budgets. It records provider, model, selection policy version, and reason, and fails closed when no candidate satisfies the constraints. Provider choice never changes role or assignment authority.

## Current scope

The installed Node accepts a bounded collection of distinct Discord agent deployments. Bot speakers use one application each. Webhook speakers may share the exact Gateway application and bot credential while retaining distinct webhook IDs, owner-only webhook tokens, hired-agent bindings, current role hashes, provider and model routing, storage, response ownership, and delivery adapters. Every owned agent turn loads that agent's reviewed context through the managed context coordinator used for repository search and evidence.

Shared-guild peer author and mention aliases normalize to the peer's single workforce participant. Before semantic relevance, deterministic turn ownership assigns exact participant mentions to their addressees, selects one participant per mentioned role, and selects a stable participant for unaddressed turns. The uniquely configured CEO is the general-channel default; a project channel with one PO remains with that PO. Non-owners record `turn_not_owned` without typing or provider work. Typing starts when an owner begins semantic resolution and continues through an active native work turn. Bounded recent context retains the speaker's participant, agent, and role identity. Aggregate readiness and failure remain fail-closed.

Within a multi-bot Node, an exact reviewed manual participant binding overrides the automatic co-resident peer binding for the same tenant and speaker identity. This lets a coordinating agent start a bounded automation chain without conflicting identity rows or extending the override to every peer.

Installed Node deployments can map bounded canonical repository event types to proactive signals and run explicit cross-provider deliberation through the durable queue. Both preserve deterministic turn ownership, managed retrieval, provider budgets, repository verification, CAS, and event evidence. Discord is only the current transport.

The installed executive boundary executes hash-bound, allowlisted Discord text-channel and public-thread effects with durable replay and fail-closed uncertainty. The installed deliberation worker reconciles uncertain outcomes from canonical CLI evidence and publishes a bounded visible result through the managed conversation path.

Implemented capabilities:

- Webhook-backed delivery.
- Same-Node and explicitly bound cross-Node peer-author normalization.
- Shared-Gateway validation and replay-safe executive webhook preparation.
- Authenticated parent/thread resolution and native thread delivery.
- Bot-native replies and source-message reply correlation.
- Natural allowlisted text-channel and current-channel public-thread creation.
- Natural repository-scoped child-agent hiring by an exactly bound product owner.
- Atomic child organization, external-deployment, and channel-membership binding before supervised activation.
- Exact leading `@DisplayName` addressing for webhook-backed participants that Discord cannot natively mention.
- Resumable native Codex and Claude repository work with durable per-agent sessions, duplicate suppression, bounded result artifacts, and Git change observation.
- Conflict-safe Mac and WSL repository replicas preserving exact uncommitted worktree and index bytes bidirectionally, with fresh parity required before and after changed native work.
- Post-turn enforcement of current workstream, canonicalization declaration, and repository knowledge lifecycle, plus bounded CAS-backed prior work results per durable worker.
- Stable CEO ownership for unaddressed general-channel turns and early owner-only typing activity.

Webhook replies remain canonical rather than native. Remaining work includes invoking agent-deployment preparation and runtime binding from natural CEO conversation, broader natural addressed groups, and the required real two-agent discussion. Each agent needing native Discord member presence, its own typing indicator, or native mentionability requires a separate installed bot application; exact Lervo `@DisplayName` addressing remains available to webhook identities.

The target organization has one shared general channel for the human owner, central executive, and all repository product owners, plus one project channel per product owner. Before creating a child workforce identity, the installed natural hiring effect binds the exact product-owner parent, organization deployment, current repository, selected installed role, provider policy, delegation depth, responsibility paths, and capability ancestry. It also binds the child as the active worker for the conversation's next native work turn, with a separate resumable provider session. It does not create an external speaker or allow cross-team hiring. Formal assignment topology and integration remain separate bounded effect paths.

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
- [ADR-0395](../../../../decisions/coordination/conversations/0395-resumable-native-repository-work-turns.md)
- [ADR-0396](../../../../decisions/coordination/conversations/0396-conflict-safe-repository-replica-continuation.md)
- [Cross-provider deliberation runtime](../../../../decisions/execution/providers/0029-cross-provider-deliberation-runtime.md)
