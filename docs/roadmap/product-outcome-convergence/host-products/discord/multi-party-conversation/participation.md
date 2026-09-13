# Multi-party participation contract

Part of [Role-backed multi-party conversation](../multi-party-conversation.md).

## Participant binding

Each hired agent instance is a participant; its role template is not. Its unique display name is separate from its role: `CEO`, `developer`, and other role labels are never synthesized as names.

Channel membership binds durable participant ID, agent ID, exact role ID and version or hash, repository scope, active lifecycle state, and provider policy. Workforce policy allows fixed `codex` or `claude` providers, or `any` for policy-driven selection. Every turn records provider and model, preserving responsibility when agents share roles, are replaced, or retire.

A Discord speaker principal is a hired agent's one-to-one external identity for an immutable deployment binding: a bot user or exact channel-to-webhook set. Hiring, Gateway installation, webhook preparation, channel membership, provider selection, and execution authority are separate transitions. Each deployment retains agent-specific durable conversation history. Broader expertise follows the source-bound context lifecycle in [ADR-0386](../../../../../decisions/coordination/conversations/0386-organization-teams-and-agent-identities.md).

## Channel composition

Channels may contain people and multiple hired agents with different roles. Messages may address a participant, agent, role, or bounded deliberation group. Policy resolves `@role` to eligible active agent participants without making role definitions actors or granting execution authority.

Every resulting turn retains speaker, addressee, thread or deliberation ID, role binding, automation depth, and evidence coordinates.

## Constraints

- Human and agent turns share natural-language intent and per-agent participation resolution.
- Every eligible unaddressed human message has one deterministic owner in conversational deployments; semantic participation failure cannot silently discard it.
- A deployment ignores messages containing Discord mentions it cannot map. It must not reclassify them as unaddressed or let an unrelated stable owner answer for the missing addressee.
- Agent-authored discussion is read-only by default.
- Unbound agent messages start at maximum automation depth. Exact reviewed peer agents may start at depth zero. Every agent-to-agent response uses reply correlation so separate integrations advance the same depth and stop at the configured maximum. This grants no effect authority.
- Agent-authored continuation and platform effects require a separate exact participant, role, tenant, and conversation opt-in, retaining existing signed command and allowlisted-effect boundaries.
- Repository mutation, external effects, assignment changes, and approval resolution require existing authority paths.
- Participation policies, maximum automation depth, response budgets, explicit deliberation termination, and self-message suppression must prevent agent reply loops.

Read-only discussion includes requested repository inspection and bounded code excerpts. Natural repository work enters a resumable native Codex or Claude tool session on the repository Node. It records durable session and result coordinates and Git-observed changes without manufacturing exact-path managed-run evidence. Exact-path reviewed changes may still use managed continuation.

Agents may create allowed threads, reply, and mention participants when conversation and organization policy permit. These surface actions are distinct from repository authority. Native reply projection is selected per turn only when it clarifies a concurrent or explicit reply relationship. Ordinary sequential answers remain standalone rather than automatically replying to every source message.

## Automatic provider selection

Selection evaluates the hired agent's provider policy, exact role capabilities, provider availability, and configured cost and latency budgets. It records provider, model, selection policy version, and reason, and fails closed when no candidate satisfies the constraints. Provider choice never changes role or assignment authority.
