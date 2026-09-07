# Role-backed multi-party conversation

Part of [Discord remote continuation](../discord.md).

State: `delivery required`.

Each hired agent instance, not the role template itself, becomes a conversation participant. Its channel membership binds the durable participant ID, agent ID, exact role ID and version or hash, repository scope, active lifecycle state, and provider policy. The existing workforce contract permits a fixed `codex` or `claude` provider or `any` for policy-driven selection; the actual turn still records the selected provider and model. This preserves responsibility when multiple agents share one role or an agent is replaced or retired.

A channel can contain people and multiple hired agents with different roles. Messages may address one participant, one agent, one role, or a bounded deliberation group. `@role` is resolved by policy to eligible active agent participants; it does not turn the role definition into an actor or grant new execution authority. Every resulting turn retains its speaker, addressee, thread or deliberation ID, role binding, automation depth, and evidence coordinates.

Natural-language intent resolution remains shared across human and agent turns. Agent-authored discussion is read-only by default. Repository mutation, external effects, assignment changes, and approval resolution still require their existing authority paths. Participation policies, maximum automation depth, response budgets, explicit deliberation termination, and self-message suppression must prevent agent reply loops.

Automatic provider selection must evaluate the hired agent's provider policy, exact role capabilities, provider availability, and configured cost and latency budgets. It must record the selected provider, model, selection policy version, and reason; it must fail closed when no candidate satisfies those constraints. Provider choice never changes role or assignment authority.

Acceptance requires one real channel with one person and at least two hired agents in distinct roles to complete a bounded discussion, preserve every participant and role coordinate, stop at its declared terminal condition, and produce no unauthorized repository or external effect.

See [ADR-0384](../../../../decisions/coordination/conversations/0384-explicit-discord-read-and-continuation-modes.md) and [cross-provider deliberation runtime](../../../../decisions/execution/providers/0029-cross-provider-deliberation-runtime.md).
