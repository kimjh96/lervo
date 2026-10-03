# Deployments, context, and turn ownership

## Deployments and context

An installed Node accepts a bounded collection of distinct Discord agent deployments. Each bot speaker has its own application. Webhook speakers may share the exact Gateway application and bot credential while retaining distinct webhook IDs, owner-only webhook tokens, hired-agent bindings, current role hashes, provider/model routing, storage, response ownership, and delivery adapters.

Every owned turn loads the agent's reviewed context through the managed context coordinator used for repository search and evidence.

## Turn ownership and peer binding

Shared-guild peer author and mention aliases normalize to one workforce participant per peer. Before semantic relevance, deterministic ownership:

- Assigns exact participant mentions to their addressees.
- Resolves Discord-managed bot-role mentions to exact bot participants only after authenticated guild-role verification. Unresolved role addresses never fall through to the channel default.
- Selects one participant per mentioned role.
- Selects one stable unaddressed owner using explicit per-participant priorities shared by local and cross-Node bindings. A deployment can make the central executive the general-channel default; the `CEO` role string has no special behavior.
- Preserves a human's explicit interlocutor through hiring-driven runtime restart. Hiring or work assignment does not make the new assignee the human's conversation target.
- Releases missing or idle interlocutors and deterministically selects exactly one current owner.

Non-owners record `turn_not_owned` without typing or provider work. Owner typing begins with semantic resolution and continues through active native work. Bounded recent context retains participant, agent, and role identity. Aggregate readiness and failure remain fail-closed.

A successful hire publishes its bounded acknowledgment before requesting runtime reconfiguration. The owner of a subsequent work instruction starts visible typing and ends with one verified result, duplicate-suppression notice, or bounded terminal failure. Silence is not successful completion.

Within a multi-bot Node, an exact reviewed manual participant binding overrides the automatic co-resident binding for the same tenant and speaker identity. This lets a coordinating agent start a bounded automation chain without conflicting identity rows; the override does not extend to every peer.
