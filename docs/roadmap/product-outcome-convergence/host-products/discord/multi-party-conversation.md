# Role-backed multi-party conversation

Part of [Discord remote continuation](../discord.md).

State: `delivery required`.

## Participant binding

Each hired agent instance—not the role template—becomes a conversation participant. Channel membership binds: durable participant ID, agent ID, exact role ID and version or hash, repository scope, active lifecycle state, and provider policy. The workforce contract permits a fixed `codex` or `claude` provider or `any` for policy-driven selection; the selected provider and model are recorded on each turn. This preserves responsibility when multiple agents share one role or an agent is replaced or retired.

## Channel composition

A channel may contain people and multiple hired agents with different roles. Messages may address one participant, one agent, one role, or a bounded deliberation group. `@role` is resolved by policy to eligible active agent participants; it does not turn the role definition into an actor or grant new execution authority. Every resulting turn retains: speaker, addressee, thread or deliberation ID, role binding, automation depth, and evidence coordinates.

## Constraints

- Natural-language intent resolution is shared across human and agent turns.
- Agent-authored discussion is read-only by default.
- Repository mutation, external effects, assignment changes, and approval resolution require their existing authority paths.
- Participation policies, maximum automation depth, response budgets, explicit deliberation termination, and self-message suppression must prevent agent reply loops.

## Automatic provider selection

Selection must evaluate the hired agent's provider policy, exact role capabilities, provider availability, and configured cost and latency budgets. It must record the selected provider, model, selection policy version, and reason. It must fail closed when no candidate satisfies those constraints. Provider choice never changes role or assignment authority.

## Current scope

The installed single-participant prerequisite now accepts a responding `agentId`, verifies its active workforce record and exact current role hashes at Node startup, enforces its fixed-or-any provider policy for read responses, and keeps the participation role separate from the mutation command role. Addressed multi-agent selection, bounded group turn ownership, and the required two-agent discussion remain in this outcome.

## Acceptance

One real channel with one person and at least two hired agents in distinct roles must complete a bounded discussion, preserve every participant and role coordinate, stop at its declared terminal condition, and produce no unauthorized repository or external effect.

## References

- [ADR-0384](../../../../decisions/coordination/conversations/0384-explicit-discord-read-and-continuation-modes.md)
- [Cross-provider deliberation runtime](../../../../decisions/execution/providers/0029-cross-provider-deliberation-runtime.md)
