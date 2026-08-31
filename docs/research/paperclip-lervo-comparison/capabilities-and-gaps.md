# Paperclip and Lervo capabilities and gaps

## Capability comparison

| Area | Paperclip | Lervo | Judgment |
| --- | --- | --- | --- |
| Product model | Companies, goals, organization, projects, issues, approvals, budgets | Repositories, workstreams, roles, agents, assignments, evidence, verification | Different primary layers |
| Human interface | React dashboard and task-oriented views | CLI-first with bounded Hub control and traces | Paperclip ahead |
| Work loop | Goal → issue → heartbeat → comment or review → next wake | Workstream → assignment → managed run → verification and handoff | Paperclip is easier; Lervo is stricter |
| Concurrency | Atomic single-assignee issue checkout | Assignment lease plus overlapping-path rejection | Lervo is more precise for repository conflicts |
| Automation | Schedule, assignment, mention, manual, approval, cron, webhook, API triggers | Managed runs, terminal hooks, Nodes, optional Hub | Paperclip ahead in user-facing routines |
| Cost control | Company, project, and agent usage with warnings and hard stops | No equivalent first-class provider-cost product found | Paperclip ahead |
| Provider reach | Multiple local agents plus process, HTTP, and external adapters | Codex and Claude share the strongest managed contract | Paperclip has breadth; Lervo has stronger common assurance |
| Evidence | Run logs, activity, transcripts, costs | Distinct selected, loaded, injected, referenced, unsupported-use states | Lervo ahead |
| Knowledge | Issues, documents, work products, skills, plugins | Bounded scan, compilation, review, lineage, impact, query, exchange | Lervo ahead |
| Capability supply chain | Discoverable catalog and import UX | Immutable coordinates, dependency closure, permissions, activation, invocation evidence | Paperclip has better UX; Lervo has stronger exactness |
| Local authority | Self-hosted server with embedded PostgreSQL | Local project and canonical repository state remain authoritative without a Hub | Lervo ahead |

## Product gaps

### Unified operating view

Lervo has durable agent, assignment, lease, handoff, workstream, approval, verification, and evidence state, but lacks an approachable view of who is working, what is blocked, what needs approval, what is stale, and what is reported versus verified. This is primarily a projection and product-surface gap, not a missing execution kernel.

### Everyday collaboration

Paperclip makes goal ancestry, tickets, comments, inboxes, reviews, and work products first-class. Lervo's bounded repository assignment and handoff contracts are stronger but less accessible to researchers, marketers, designers, and other non-development roles.

### Routines and heartbeats

Paperclip can wake agents from schedules, assignments, mentions, manual actions, approval resolution, cron, webhooks, and APIs. Lervo is stronger after a terminal or managed run starts, but its user-facing recurring-work model is less complete.

### Usage and budgets

Paperclip exposes spending and budget behavior. Lervo provides byte, time, path, policy, and verification bounds, but this research found no equivalent first-class monetary or token-budget experience.

### Provider and runtime reach

Paperclip supports more agent runtimes. Lervo should consider process or HTTP adapters only with explicitly lower assurance when they cannot meet the Codex and Claude managed evidence contract.

### Capability discovery

Lervo has strong resolution and activation contracts, but operators need easier discovery, provenance review, drift comparison, dependency-change review, and permission-delta review.
