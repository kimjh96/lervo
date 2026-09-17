# Installed multi-party scope

Part of [Role-backed multi-party conversation](../multi-party-conversation.md).

## Deployments and context

The installed Node accepts a bounded collection of distinct Discord agent deployments. Each bot speaker uses its own application. Webhook speakers may share the exact Gateway application and bot credential while retaining distinct webhook IDs, owner-only webhook tokens, hired-agent bindings, current role hashes, provider and model routing, storage, response ownership, and delivery adapters.

Every owned agent turn loads that agent's reviewed context through the managed context coordinator used for repository search and evidence.

## Turn ownership and peer binding

Shared-guild peer author and mention aliases normalize to the peer's single workforce participant. Before semantic relevance, deterministic turn ownership:

- Assigns exact participant mentions to their addressees.
- Selects one participant per mentioned role.
- Selects a stable participant for unaddressed turns. The uniquely configured CEO is the general-channel default; a project channel with one PO remains with that PO.
- Retains a human's explicit interlocutor across hiring-driven runtime restart without turning the newly hired work assignee into the human's conversation target.
- Releases missing or idle interlocutors and deterministically selects exactly one current owner.

Non-owners record `turn_not_owned` without typing or provider work. Typing starts when an owner begins semantic resolution and continues through an active native work turn. Bounded recent context retains the speaker's participant, agent, and role identity. Aggregate readiness and failure remain fail-closed.

A successful hire publishes its bounded acknowledgement before requesting runtime reconfiguration. Hiring or assigning work does not itself change the human interlocutor. The owner of a subsequent work instruction starts visible typing and must end in one verified result, duplicate-suppression notice, or bounded terminal failure; silence is not a successful lifecycle state.

Within a multi-bot Node, an exact reviewed manual participant binding overrides the automatic co-resident peer binding for the same tenant and speaker identity. This lets a coordinating agent start a bounded automation chain without conflicting identity rows or extending the override to every peer.

## Proactive signals, deliberation, and effects

Installed Node deployments can map bounded canonical repository event types to proactive signals and run explicit cross-provider deliberation through the durable queue. Both preserve deterministic turn ownership, managed retrieval, provider budgets, repository verification, CAS, and event evidence. Discord is only the current transport.

Named conversation speakers and formal-deliberation participants are separate identity planes. An ordinary Discord speaker is backed by a durable hired-agent binding (`agentId`, role version and hashes, participant, and bot or webhook deployment). Assigned formal deliberation now binds a policy seat automatically when exactly one active hired-agent deployment with the same role and compatible provider policy is present in the origin conversation, uses that durable agent's display name, preserves the binding across checkpoint resume, and releases it on a terminal outcome. A missing exact match remains policy-only, while ambiguous or contradictory evidence fails before provider execution. The currently installed participant list still does not prove that every intended stakeholder role has such a matching hired agent or that the complete discussion was observed through those same Discord identities. Provisioning the remaining role-matched agents and completing that installed round trip remain acceptance requirements. User-facing copy must not present a policy role as if it were an observed named agent.

The installed executive boundary executes hash-bound, allowlisted Discord text-channel and public-thread effects with durable replay and fail-closed uncertainty. The installed deliberation worker reconciles uncertain outcomes from canonical CLI evidence and publishes a bounded visible result through the managed conversation path.

Natural deliberation preserves the original human reply coordinate across synthetic status signals, retains bounded prior human anchors for references such as "this design," and selects a versioned Korean or English conversation writing contract from the source request. Failed writing checks are supplied to the one bounded repair attempt instead of repeating an undirected rewrite.

## Implemented capabilities

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
- A WSL single-writer execution default that keeps native conversation work available while conflict-safe Mac recovery replicas preserve exact uncommitted worktree and index bytes for explicit reconciliation. Strict fresh parity remains opt-in for controlled topologies, with bounded peer-command execution, configurable bridge concurrency, and terminal completion detection for an unloaded installed coordinator.
- Post-turn enforcement of current workstream, canonicalization declaration, and repository knowledge lifecycle, plus bounded CAS-backed prior work results per durable worker.
- Stable CEO ownership for unaddressed general-channel turns and early owner-only typing activity.
- Bounded durable human-interlocutor focus shared by co-resident deployments and recovered after restart.
- Semantic repository-work profiles that route routine work to balanced settings and design, judgment, and review to high-effort settings, while preserving provider-bound session identity and recording the allocation reason.

## Limits and remaining work

Webhook replies remain canonical rather than native. Natural product-owner hiring already invokes agent-deployment preparation, organization binding, runtime configuration, and post-acknowledgement restart for the durable child speaker. Remaining work includes extending that governed path to a natural central-CEO request across repository teams, broader natural addressed groups, the required real two-agent discussion, and binding formal-deliberation stakeholder seats to the same durable named agents visible on Discord.

Each agent needing native Discord member presence, its own typing indicator, or native mentionability requires a separate installed bot application. Exact Lervo `@DisplayName` addressing remains available to webhook identities.

## Organization and natural hiring

The target organization has one shared general channel for the human owner, central executive, and all repository product owners, plus one project channel per product owner.

Before creating a child workforce identity, the installed natural hiring effect binds the exact product-owner parent, organization deployment, current repository, selected installed role, provider policy, delegation depth, responsibility paths, and capability ancestry. It also binds the child as the active worker for the conversation's next native work turn, with a separate resumable provider session.

For an authorized product-owner hire, this effect prepares a webhook-backed external speaker and atomically binds it before post-acknowledgement activation. It does not allow cross-team hiring. A central-CEO request spanning repository teams, formal assignment topology, and formal-deliberation seat integration remain separate bounded effect paths.
