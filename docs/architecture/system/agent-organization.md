# Agent organization

Lervo coordinates repository-backed project teams over shared infrastructure. Each team retains separate repository truth, knowledge, workforce, authority, budgets, workstreams, and conversation coordinates. Central policies and a uniquely named agent appointed to the executive role may observe and route across teams but cannot silently merge them.

```text
human owner or board
  -> named central executive agent (CEO responsibility)
     -> repository product owner (Lervo)
        -> specialist hired agents
     -> project team (Shiflo)
        -> repository product owner
           -> specialist hired agents
     -> project team (Plen)
        -> repository product owner
           -> specialist hired agents
     -> new project teams

shared control plane
  -> objectives and operating projections
  -> workforce, assignments, handoffs, approvals, and deliberation
  -> durable execution, resume, scheduling, and budgets
  -> knowledge, context selection, capabilities, and evidence
  -> conversation adapters and external agent identities
```

The organization contract covers [identity and deployment](agent-organization/identity-and-deployment.md), [reviewed agent context](agent-organization/reviewed-agent-context.md), and [coordination and authority](agent-organization/coordination-and-authority.md).

The central executive and repository product owners are distinct durable agents. A product owner may hire and assign child agents only through an exact policy limited to its own repository-backed team, budget, delegation depth, and capability ancestry. Central coordination does not make the executive the Lervo repository product owner. Shared conversations do not widen participants' team authority.

The [outcome supervision design](../../specifications/execution/outcome-supervision.md) extends these foundations with accountable product owners, autonomous worker responsibility allocation, and central escalation. It remains implementation work, not an installed autonomy claim.

See [ADR-0386](../../decisions/coordination/conversations/0386-organization-teams-and-agent-identities.md), [ADR-0390](../../decisions/coordination/conversations/0390-project-reviewed-agent-context-and-headless-organization-control.md), [ADR-0393](../../decisions/coordination/conversations/0393-named-agent-identity-and-installed-organization-effects.md), and [ADR-0394](../../decisions/coordination/conversations/0394-webhook-backed-discord-agent-identities.md).
