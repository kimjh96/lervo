# ADR-0393: Named agent identity and installed organization effects

- Status: accepted
- Decision date: 2026-09-09

Partially superseded by [ADR-0560](../../foundation/0560-remove-unused-subsystems-to-harden-the-core.md): the organization effects part is removed. Lervo no longer ships the organization execution boundary, its replay store, or the Discord executive adapter. Named identity, team classification, deployment rotation, surface-neutral work, natural Discord channel and thread creation in the Node runtime, and uncertain-deliberation reconciliation stay.

## Context

The organization model separated hired agents from roles, provider turns, and one-to-one Discord deployments but lacked human-facing workforce names. Surfaces could confuse a role such as `CEO` with agent identity. The organization policy evaluator produced pure decisions without an installed, replay-safe boundary for approved Discord administration.

Managed deliberation marked unprovable provider outcomes uncertain, but the installed conversation surface neither reconciled them nor published a bounded, human-readable terminal status. Internal queue coordinates could remain an operator concern instead of clearly ending the conversation.

## Decision

### Named identity and team classification

Every current workforce agent has a `displayName` and `displayNameSource` of `explicit`, `generated`, or `legacy_derived`. New hires may supply a unique name; otherwise, Lervo generates a neutral name from the durable agent ID. Legacy records derive stable neutral names on read. Rename is an exact-revision workforce transition. Roles remain reusable authority and expertise contracts; providers and models remain turn-execution evidence. Neither becomes the display name.

The `agent.identity.changed` workforce event has an explicit `changeKind`:

- `display_name` requires `agentId`, `previousDisplayName`, `displayName`, `displayNameSource`, and `revision`.
- `role_binding` retains those identity coordinates and additionally requires previous and next role IDs, versions, contract hashes, profile hashes, the next capability hash, and revision.
- Legacy events without `changeKind` are display-name transitions.

`organization.agent.identity.changed` synchronizes only display-name changes across exact organization, team, project, and membership coordinates. Its projection updates active membership and active external deployment without changing role, provider policy, employment, or channel authority. Role rebinding instead appends an exact `organization.agent.membership.changed` revision and rotates every affected external deployment. Names are bounded, non-secret display metadata; raw platform IDs and credentials remain excluded.

`organization.team.kind.changed` reclassifies one exact existing repository team between `central` and `project`. It requires immutable organization, team, project, and repository identity coordinates, previous and next kinds, a monotonic revision, and `changedAt`. Stale coordinates or unchanged kinds fail as `organization_state_conflict`. Reclassification never moves repository authority or data.

Changing a deployment's provider, model, command role, conversation set, or hired-agent role binding rotates the deployment instead of mutating bound evidence. The runtime-binding transaction ends every active channel membership on the replaced deployment, retires it with `configuration_replaced`, appends the exact membership revision when needed, then binds a new deployment and channel memberships. Exact repeated configuration is idempotent. A principal bound to another active agent fails closed. Immutable deployment history survives changes to per-agent execution settings.

The conversation-platform projection follows rotation, refreshing role coordinates only when the external principal, internal participant, and durable hired-agent ID remain exact. It never accepts a different agent ID under an existing principal. Prior normalized message events retain their original actor and role snapshot; current participation-authority changes neither discard context nor rewrite history.

### Organization effects

An organization executive is an appointed named agent operating under a role and policy, not an agent named `CEO`. The surface-neutral organization execution boundary binds an allowed request to the exact effect payload, adapter, team, budget policy, automation depth, and decision hash. The installed Discord adapter supports allowlisted text-channel and public-thread creation, reads credentials only from owner-controlled Node configuration, and verifies the exact Discord response.

The durable replay store reserves each external effect before dispatch. Verified receipts replay without repeating effects. Explicit platform rejection is terminal. Timeout, transport loss, malformed responses, reserved records after interruption, and all otherwise unprovable results become `uncertain` and are never automatically retried. Capacity is fixed at 10,000 records and fails closed at that bound.

### Surface-neutral work and collaboration

Discord is the first installed surface over managed conversation, workforce, assignment, execution, context, evidence, and organization application contracts, not a reduced chat-only runtime. Through these boundaries, hired agents may inspect and quote requested code, enter authorized repository work, publish verified results, create threads, reply, mention eligible participants, and converse with other agents. Channels and mentions never grant repository or external-effect authority.

The appointed CEO may hire internal workforce agents, assign teams, create allowlisted Discord channels and public threads, and coordinate work when exact organization policy and effect authorization allow it. Creating Discord applications, issuing tokens, and authorizing guild installation remain external owner/platform actions. Hiring an agent and binding an already authorized external bot identity remain separate transitions.

The CEO and repository product owners are distinct hired agents. The Lervo repository has its own product owner; the central CEO does not implicitly own that responsibility. A product owner may be appointed delegated project operator for one exact repository team. Its allowlist may include `agent.hire`, `assignment.delegate`, and bounded deliberation for that team, but cannot change central policy, operate on another team, or create, issue, or install Discord applications and credentials. Every resulting hire records the product owner as parent, preserves responsibility-path and capability-package ancestry, and remains separately deployable.

The installed `workforce_agent_hire` conversation effect implements hiring without a provider-generated shell command. Its bounded argument contains exactly the explicit display name, installed role ID, and provider policy. The Node supplies the current repository and responding product-owner parent from its immutable deployment binding. Before appending the canonical hire event, the workforce domain validates role resolution, unique human-facing identity, repository capacity, delegation depth, fixed repository responsibility, and inherited capability packages. A successful retry converges on the exact active child identity; it never creates a Discord application or external deployment.

An organization-wide general conversation includes the owner, central CEO, and repository product owners. Each product owner also belongs to its project conversation. General-channel membership permits only coordination and addressed discussion; repository writes, hiring, assignments, and platform effects require their exact authority paths. Ordinary sequential discussion remains standalone; replies, threads, and mentions are selected only when they clarify the conversation.

Every hired agent accumulates reviewed identity, work, relationship, and expertise context under its durable agent ID. Surface history informs that lifecycle but is not canonical memory by itself. Shiflo, Plen, and Arac remain distinct repository teams with separate authority and context; central coordination uses explicit routes, assignments, handoffs, or policy.

A future first-party Lervo interface must replace or coexist with Discord through the same headless contracts, replaying the same durable identities, context, conversation coordinates, work, and evidence. Provider adapters and repository execution do not move into the surface.

### Uncertain deliberation

After uncertain execution, the installed deliberation worker inspects canonical CLI status instead of rerunning execution. A verified terminal or resumable status enters the ordinary managed conversation path as `deliberation.completed`. After the configured bounded number of inconclusive inspections, `deliberation.attention` produces one human-readable status.

These signals exclude deliberation, workstream, request, and platform IDs from message content. They still pass participation, retrieval, context, provider-budget, writing, delivery, and event-evidence boundaries. Discord remains only the transport.

## Consequences

Product surfaces can show a stable named expert separately from role and provider evidence. Renaming cannot silently expand authority. A future first-party Lervo interface can invoke the same product-host organization routes and normalized conversation application without importing Discord behavior.

Discord cannot create a separately authenticated bot application, issue its token, or authorize installation on the owner's behalf. Under [ADR-0394](0394-webhook-backed-discord-agent-identities.md), this no longer blocks multiple named Lervo speakers: an installed bot with allowlisted `MANAGE_WEBHOOKS` authority can prepare separate incoming-webhook identities whose tokens remain in owner-only runtime storage. Distinct guild-member bot identities still require separate applications.

Lervo may claim better task performance than direct Codex CLI or Claude Code only for installed paired scenarios with evidence of improvement. Repository grounding, authority checks, verification, retry stability, and durable context are the intended advantages; provider intelligence is not relabeled as a Lervo result.

## References

- [Organization teams and agent identities](0386-organization-teams-and-agent-identities.md)
- [Terminal conversation response failures](0387-terminal-conversation-response-failures.md)
- [Installed proactive signals and managed conversation deliberation](0392-installed-proactive-signals-and-deliberation.md)
- [Agent organization](../../../architecture/system/agent-organization.md)
