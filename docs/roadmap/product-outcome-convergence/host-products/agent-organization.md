# Multi-team agent organization

Part of [Paperclip-, Buzz-, loop-, graph-, and host-product outcomes](../host-products.md).

State: `delivery required`.

## Outcome

One human owner operates a Lervo organization with central leadership and several repository-backed project teams. Each hired expert agent retains a durable identity, exact role history, provider-neutral context, one-to-one external bot identity, explicit channel membership, and scoped authority. A central CEO agent coordinates teams and performs reviewed organization and Discord administration within policy.

## Current foundations

Implemented foundations include:

- Workforce identity, roles, assignments, handoffs, workstreams, and approvals.
- Bounded scheduling and graphs, provider-neutral deliberation, and per-bot Discord deployments.
- Exact agent and role hashes in conversation records, agent-bound managed read-run causality, and bounded agent-specific recent conversation input.
- Repository-local append-only contracts for teams, agent membership, external deployment, channel membership, and deliberation participation.

The CLI can bind current hired agents and Discord deployments. An organization-configured Node fails closed on an identity mismatch. These foundations do not complete the organization outcome.

## Completion criteria

1. Extend repository-local organization and project-team membership contracts into a central multi-team operating projection.
2. Deliver CEO policy, budget, delegation, approval, and Discord administration adapters.
3. Deliver an agent-context namespace with source-bound promotion, projection rebuild, retirement, and successor handoff.
4. Support natural addressed routing for participants, roles, teams, and bounded discussion groups.
5. Install one scenario with a human, CEO, and at least two project teams whose agents collaborate without crossing authority or context boundaries.
6. Demonstrate two distinct installed agent bots completing a bounded deliberation in one real Discord channel and stopping at its terminal condition.

## References

- [ADR-0386](../../../decisions/coordination/conversations/0386-organization-teams-and-agent-identities.md)
- [Role-backed multi-party conversation](discord/multi-party-conversation.md)
