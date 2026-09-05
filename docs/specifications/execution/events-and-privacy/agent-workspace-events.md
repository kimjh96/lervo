# Agent workspace and capability events

The isolated-workspace design adds canonical coordination events to the shared repository-instance home.

## Contracts

- [Workspace lifecycle, integration, and removal](agent-workspace-events/workspace-lifecycle.md)
- [Hub audit transitions](agent-workspace-events/hub-audit-transitions.md)
- [Capability and skill observations](agent-workspace-events/capability-and-skill-observations.md)

## Workspace privacy and failure

All workspace payloads exclude absolute and repository-relative paths, branch names, task and acceptance prose, source and patch bodies, commands, prompts, provider output, terminal content, credentials, approvals, reasoning, and unrestricted errors.

Event failure rolls back the state transition when the host effect is reversible. Uncertain provisioning or removal enters `recovery_required` and emits no success event.
