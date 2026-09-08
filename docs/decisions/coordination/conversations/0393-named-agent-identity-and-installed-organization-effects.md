# ADR-0393: Named agent identity and installed organization effects

- Status: accepted
- Decision date: 2026-09-09

## Context

The organization model distinguished a hired agent from its role, provider turn, and one-to-one Discord deployment. The workforce projection lacked a human-facing name, allowing surfaces to mistake a role such as `CEO` for agent identity. The organization policy evaluator returned a pure decision but lacked an installed, replay-safe boundary for approved Discord administration.

Managed deliberation execution marked unprovable provider outcomes uncertain, but the installed conversation surface neither reconciled that state nor published a bounded human-readable terminal status. Internal queue coordinates could remain an operator concern instead of clearly ending the conversation.

## Decision

### Named identity and team classification

Every current workforce agent has a `displayName` and `displayNameSource`; the source is `explicit`, `generated`, or `legacy_derived`. New hires accept an optional unique name; otherwise Lervo generates a neutral name from the durable agent ID. Legacy records derive a stable neutral name on read. Rename is an exact-revision workforce transition. A role remains a reusable authority and expertise contract; a provider or model remains turn execution evidence. Neither becomes the display name.

The `agent.identity.changed` workforce event requires `agentId`, `previousDisplayName`, `displayName`, `displayNameSource`, and `revision`. The `organization.agent.identity.changed` event additionally binds the exact organization, team, project, and membership. Its projection updates active membership and active external deployment without changing role, provider policy, employment, or channel authority. Names are bounded non-secret display metadata; raw platform IDs and credentials remain excluded.

The `organization.team.kind.changed` event reclassifies one exact existing repository team between `central` and `project`. It requires immutable organization, team, project, and repository identity coordinates, previous and next kinds, a monotonic revision, and `changedAt`. Stale coordinates or unchanged kinds fail as `organization_state_conflict`. Reclassification never moves repository authority or data.

### Organization effects

An organization executive is an appointed named agent operating under a role and policy, not an agent whose name is `CEO`. The surface-neutral organization execution boundary binds a previously allowed request to the exact effect payload, adapter, team, budget policy, automation depth, and decision hash. The installed Discord adapter currently supports allowlisted text-channel and public-thread creation. It reads credentials only from owner-controlled Node configuration and verifies the exact Discord response.

The durable replay store reserves each external effect before dispatch. A verified receipt is replayed without repeating the effect. Explicit platform rejection is terminal. Timeout, transport loss, malformed response, a reserved record after interruption, or any otherwise unprovable result becomes `uncertain` and is never automatically retried. The state has a fixed 10,000-record capacity and fails closed at the bound.

### Uncertain deliberation

After uncertain execution, the installed deliberation worker inspects canonical CLI status instead of rerunning execution. A verified terminal or resumable status enters the ordinary managed conversation path as `deliberation.completed`. After the configured bounded number of inconclusive inspections, `deliberation.attention` produces one human-readable status.

These signals include no deliberation, workstream, request, or platform IDs in message content. They still pass participation, retrieval, context, provider-budget, writing, delivery, and event-evidence boundaries. Discord remains only the transport.

## Consequences

Product surfaces can render a stable named expert while separately showing role and provider evidence. Renaming cannot silently expand authority. A future first-party Lervo interface can invoke the same product-host organization routes and normalized conversation application without importing Discord behavior.

Discord cannot create a separately authenticated bot application, issue its token, or authorize its installation on the owner's behalf. One named agent can therefore be fully deployed with the current credential; external acceptance of two simultaneously visible agent identities remains conditional on a second application credential and guild installation.

## References

- [Organization teams and agent identities](0386-organization-teams-and-agent-identities.md)
- [Terminal conversation response failures](0387-terminal-conversation-response-failures.md)
- [Installed proactive signals and managed conversation deliberation](0392-installed-proactive-signals-and-deliberation.md)
- [Agent organization](../../../architecture/system/agent-organization.md)
