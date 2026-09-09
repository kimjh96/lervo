# ADR-0393: Named agent identity and installed organization effects

- Status: accepted
- Decision date: 2026-09-09

## Context

The organization model distinguished hired agents from roles, provider turns, and one-to-one Discord deployments but lacked human-facing workforce names. Surfaces could mistake a role such as `CEO` for agent identity. The organization policy evaluator returned a pure decision without an installed, replay-safe boundary for approved Discord administration.

Managed deliberation marked unprovable provider outcomes uncertain, but the installed conversation surface neither reconciled that state nor published a bounded, human-readable terminal status. Internal queue coordinates could remain an operator concern instead of clearly ending the conversation.

## Decision

### Named identity and team classification

Every current workforce agent has a `displayName` and `displayNameSource`; the source is `explicit`, `generated`, or `legacy_derived`. New hires may supply an optional unique name; otherwise, Lervo generates a neutral name from the durable agent ID. Legacy records derive a stable neutral name on read. Rename is an exact-revision workforce transition. Roles remain reusable authority and expertise contracts; providers and models remain turn-execution evidence. Neither becomes the display name.

The `agent.identity.changed` workforce event has an explicit `changeKind`:

- `display_name` requires `agentId`, `previousDisplayName`, `displayName`, `displayNameSource`, and `revision`.
- `role_binding` retains those identity coordinates and additionally requires previous and next role IDs, versions, contract hashes, profile hashes, the next capability hash, and revision.
- Legacy events without `changeKind` are display-name transitions.

`organization.agent.identity.changed` synchronizes only the display-name variant across exact organization, team, project, and membership. Its projection updates active membership and active external deployment without changing role, provider policy, employment, or channel authority. Role rebinding instead appends an exact `organization.agent.membership.changed` revision and rotates every affected external deployment. Names are bounded, non-secret display metadata; raw platform IDs and credentials remain excluded.

`organization.team.kind.changed` reclassifies one exact existing repository team between `central` and `project`. It requires immutable organization, team, project, and repository identity coordinates, previous and next kinds, a monotonic revision, and `changedAt`. Stale coordinates or unchanged kinds fail as `organization_state_conflict`. Reclassification never moves repository authority or data.

Changing a deployment's provider, model, command role, conversation set, or hired-agent role binding rotates the deployment rather than mutating its bound evidence. The runtime-binding transaction ends every active channel membership on the replaced deployment, retires it with `configuration_replaced`, appends the exact membership revision when needed, then binds a new deployment and channel memberships. Exact repeated configuration is idempotent. A principal bound to another active agent fails closed. Immutable deployment history is preserved while per-agent execution settings evolve.

The conversation-platform projection follows rotation by refreshing role coordinates only when the external principal, internal participant, and durable hired-agent ID remain exact. It never accepts a different agent ID under an existing principal. Prior normalized message events retain their original actor and role snapshot; changing current participation authority neither discards context nor rewrites history.

### Organization effects

An organization executive is an appointed named agent operating under a role and policy, not an agent whose name is `CEO`. The surface-neutral organization execution boundary binds an allowed request to the exact effect payload, adapter, team, budget policy, automation depth, and decision hash. The installed Discord adapter supports allowlisted text-channel and public-thread creation, reads credentials only from owner-controlled Node configuration, and verifies the exact Discord response.

The durable replay store reserves each external effect before dispatch. A verified receipt replays without repeating the effect. Explicit platform rejection is terminal. Timeout, transport loss, malformed response, a reserved record after interruption, or any otherwise unprovable result becomes `uncertain` and is never automatically retried. Capacity is fixed at 10,000 records and fails closed at the bound.

### Surface-neutral work and collaboration

Discord is the first installed surface over the managed conversation, workforce, assignment, execution, context, evidence, and organization application contracts. It is not a reduced chat-only runtime. A hired agent may inspect and quote requested code, enter authorized repository work, publish verified results, create threads, reply, mention eligible participants, and converse with other agents through those existing boundaries. A channel or mention never grants repository or external-effect authority.

The appointed CEO may hire internal workforce agents, assign them to teams, create allowlisted Discord channels and public threads, and coordinate work when exact organization policy and effect authorization allow it. Creating a new Discord application, issuing its token, and authorizing guild installation remain external owner/platform actions; hiring an agent and binding an already authorized external bot identity remain separate transitions.

Every hired agent accumulates reviewed identity, work, relationship, and expertise context under its durable agent ID. Surface history is input to that lifecycle, not canonical memory by itself. Shiflo, Plen, and Arac remain distinct repository teams with separate authority and context; central coordination uses explicit routes, assignments, handoffs, or policy.

A future first-party Lervo interface must replace or coexist with Discord by invoking the same headless contracts and replaying the same durable identities, context, conversation coordinates, work, and evidence. Provider adapters and repository execution do not move into the surface.

### Uncertain deliberation

After uncertain execution, the installed deliberation worker inspects canonical CLI status instead of rerunning execution. A verified terminal or resumable status enters the ordinary managed conversation path as `deliberation.completed`. After the configured bounded number of inconclusive inspections, `deliberation.attention` produces one human-readable status.

These signals exclude deliberation, workstream, request, and platform IDs from message content. They still pass participation, retrieval, context, provider-budget, writing, delivery, and event-evidence boundaries. Discord remains only the transport.

## Consequences

Product surfaces can render a stable named expert while separately showing role and provider evidence. Renaming cannot silently expand authority. A future first-party Lervo interface can invoke the same product-host organization routes and normalized conversation application without importing Discord behavior.

Discord cannot create a separately authenticated bot application, issue its token, or authorize its installation on the owner's behalf. One named agent can be fully deployed with the current credential; externally accepting two simultaneously visible agent identities remains conditional on a second application credential and guild installation.

Lervo may claim better task performance than direct Codex CLI or Claude Code only for installed paired scenarios whose evidence shows the improvement. Repository grounding, authority checks, verification, retry stability, and durable context are the intended advantages; provider intelligence is not relabeled as a Lervo result.

## References

- [Organization teams and agent identities](0386-organization-teams-and-agent-identities.md)
- [Terminal conversation response failures](0387-terminal-conversation-response-failures.md)
- [Installed proactive signals and managed conversation deliberation](0392-installed-proactive-signals-and-deliberation.md)
- [Agent organization](../../../architecture/system/agent-organization.md)
