# ADR-0639: Manage roles in the core, with authority apart

Status: `accepted`
Decision date: 2026-11-26
Part of: [ADR-0637](../applications/0637-build-projects-agents-and-conversations-in-the-ade-on-the-core.md)
Related: [ADR-0205](0205-conflict-safe-repository-agent-workforce.md), [ADR-0209](0209-versioned-repository-role-contracts.md), [ADR-0386](../../coordination/conversations/0386-organization-teams-and-agent-identities.md), [ADR-0561](../../foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md)

## Context

On 2026-11-26, while setting the ADE's projects and agents (ADR-0637), the owner asked whether roles should be managed, not only chosen when hiring.

A role is a versioned contract (ADR-0209). A repository role is a committed file, `.lervo/roles/<role-id>.json`, that extends a built-in template and carries a name, a description, and the request types the role may make. Those request types are its authority: this repository's `product-owner` role, for example, may make `agent.hire` and `assignment.delegate`. An agent binds an exact role version and hash. The core ships seven built-in roles, and `lervo role list|show|validate` reads them. Nothing edits a role except writing its file.

## Decision

- The ADE lists the built-in roles and the project's roles, with the agents that use each.
- A new role always starts from a template that it extends. It is never written from nothing, because a role's authority should not be designed from scratch in a form.
- A role's name and description change freely.
- Its request types are its authority, shown apart from the rest.
  - Narrowing them takes effect at once.
  - Widening them, such as adding `agent.hire`, is a consequential change: it is cross-checked and reported after the fact, never held for approval (invariant 10).
- An edit creates a new role version. Agents keep the version they bind until they move to the new one, and moving keeps their ID and their context (ADR-0386).
- A role retires only when no active agent binds it. Built-in roles are hidden, never deleted.
- An agent may write a repository role when a requested role does not exist, as the repository instructions already allow. The ADE then tells the owner which role was written and by whom.
- Roles stay project-scoped for now. A personal library of roles and a team library come with the personal scope and with accounts.
- S2c shows the roles when hiring and in a read-only detail view. Editing and moving agents between versions come after.

## State, events, privacy, and failure meaning

The specification for role editing defines its events before it ships. A role edit is a repository write and follows invariant 10. Widening a role's request types is reported with the role, the old and new request types, and the agents bound to the role.

## Consequences

- Owners and agents shape roles without designing authority from scratch.
- Authority changes stay visible and attributable, apart from wording changes.
- Agents never change role underneath themselves; moving to a new version is explicit.
