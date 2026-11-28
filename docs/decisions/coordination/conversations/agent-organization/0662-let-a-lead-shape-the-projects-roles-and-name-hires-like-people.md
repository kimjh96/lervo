# ADR-0662: Let a lead shape the project's roles and name hires like people

Status: `accepted`
Decision date: 2026-11-28
Amends: [ADR-0639](../../../execution/orchestration/0639-manage-roles-in-the-core-with-authority-apart.md) (a role editor in the ADE, edits move the role's agents, roles are removed by command), [ADR-0209](../../../execution/orchestration/0209-versioned-repository-role-contracts.md) (an ended assignment keeps its binding as history after its role is removed)
Related: [ADR-0386](../0386-organization-teams-and-agent-identities.md), [ADR-0393](../0393-named-agent-identity-and-installed-organization-effects.md), [ADR-0561](../../../foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md), [ADR-0646](0646-lead-conversations-with-a-product-owner.md), [ADR-0657](0657-let-an-agent-hand-work-to-a-teammates-own-conversation.md)

## Context

On 2026-11-28 the owner looked at axli's team. The product owner, Bora, had hired four owners named Foundation, Machining, Drawing Understanding, and Experience. Each held the built-in Developer or Designer role.

That was not the intent. A hired agent's name should be a nickname, like Bora. Its specialty belongs in its role.

The owner asked for roles that a lead can shape:

- Lervo keeps central templates.
- In each project, a lead with the authority adds, edits, and removes roles as hiring needs them.

Bora had no way to do this. ADR-0639 decided that roles change only by writing their file, with no editor. The only roles it could hire were the seven built-in templates and the product-owner role. Nothing told it how to name a hire.

## Decision

### Templates and project roles

- The built-in roles are Lervo's central templates. A project never edits or removes them: `role_built_in`.
- A project role is a repository role (ADR-0209), `.lervo/roles/<role-id>.json`. Commands create it from one template, built-in or another project role, at its exact current version, with its own name and description. It may add request types and narrow capabilities, since capabilities merge to the most restrictive. A role written from nothing still takes a complete source file (`lervo role add --source`). ADR-0639's rule stands: no command designs a role's authority from scratch.
- A role's ID derives from its name, such as `drawing-understanding`. A name without ASCII words, such as one in Korean, derives `role-<hash>`. Two roles never share a name, compared ignoring case: `role_name_conflict`.
- `lervo role add|edit|remove` and the core link's `role.add`, `role.edit`, and `role.remove` make every change. The ADE adds a role while hiring and edits or removes one from its own sheet.

### Who may change roles

- **The owner always.** That is their terminal, and the ADE, which runs for the owner.
- **A hired agent only as far as its role reaches.** ADR-0639 makes a role's request types its authority, so no parallel permission system is needed. The agent is the one whose session runs the command, named by `LERVO_AGENT_ID`. Without the request type, the command fails with `agent_not_authorized`.

| Change                        | Request type the agent's role needs |
| ----------------------------- | ----------------------------------- |
| Add, edit, or remove a role   | `organization.coordinate`           |
| Move an agent to another role | `organization.coordinate`           |
| Hire                          | `agent.hire`                        |

- The CEO template and the product-owner template carry both request types. The other templates carry neither.
- An agent that hires makes the hire its own subagent unless it names another parent, as ADR-0393 records a product owner's hires.
- The check attributes the command to an agent, as `agent_not_caller` does. It is no sandbox against a session that edits its own environment.

### Editing moves the role's agents

- An edit writes the role's next minor version. It can change the name, the description, and the request types the role adds. An edit that changes nothing writes nothing.
- A repository keeps one current version of each role, and a stale binding fails closed. So the edit moves every agent and assignment bound to the role to the new version in the same command. This uses ADR-0561's refresh: each move records `agent.identity.changed` (`changeKind: role_binding`) or `assignment.role.binding.changed` with the previous binding. ADR-0639 said agents keep their version until they move. That holds only per move, not per role.
- A refresh plan with ambiguous capability targets restores the previous source and fails with `role_binding_blocked`. A refresh that stops partway resumes on the next `lervo upgrade`.
- A role that another role extends cannot be edited or removed: `role_extended`. Its exact ancestry pin would break, and Lervo never re-pins a role silently.

### Removing a held role is refused

- A role is removed only when nothing holds it: no agent that is not retired, and no assignment that has not ended. Otherwise the command fails with `role_in_use` and names the holders.
- Lervo never reassigns an agent's role on its own. Which role an agent moves to changes what it may do, so a person or an authorized agent decides.
- A retired agent and an ended assignment keep their exact binding as history after the role goes. ADR-0209 already kept retired agents this way. ADR-0662 adds ended assignments.
- Neither is refreshed against a later role, and the workforce migration plan skips both.
- History grants nothing: a reopened assignment resolves its role again before any claim, and fails closed.
- The removed source's bytes are kept in the project's local data so the removal can be undone.

### Hiring names the agent like a person

- The hire sheet asks for a nickname, and the role carries the specialty. A hire without a name gets an unused nickname from Lervo's list, such as Bora or Haru. It falls back to the nickname with four ID characters only when the list is used up.
- An agent's role can change after hiring. `lervo agent role` and the core link's `agent.role` keep its ID, name, and context (ADR-0386).
- ADR-0386 requires the agent to be suspended during the move. The command pauses an active agent, moves it, and resumes it, each as its own recorded transition. A move that fails resumes it at its old role.
- The session of an agent whose role carries `agent.hire` learns how to hire:
  - name each hire like a person, never by its specialty;
  - add a project role when no role fits, if its role also carries `organization.coordinate`;
  - otherwise ask the product owner to add one.

## State, events, privacy, and failure meaning

- **Role source.** `.lervo/roles/<role-id>.json` keeps its bounded v1 contract. Commands write it in one rename, and `previewRoleContracts` checks the whole registry with it first.
- **Removed role sources.** `<project data>/removed-roles/<role-id>.json` is local and owner-only. It holds at most 32 files, and the oldest goes first. It is never tracked.
- **No new event type.** Agent and assignment moves record the existing events above.
- **Effect notices.** Role changes are repository writes under invariant 10. Each records one notice after the fact in the existing effect notice journal:

| Notice                  | Undo                                                                        |
| ----------------------- | --------------------------------------------------------------------------- |
| `role_added`            | `lervo role remove`                                                         |
| `role_edited`           | An edit back to the previous words and request types                        |
| `role_removed`          | `lervo role add --source <kept file>`                                       |
| `role_template_written` | Recorded when a template role is written first, so a new role can extend it |

- A widened edit names the added request types and the agents the edit moved, as ADR-0639 requires.
- A notice that cannot be recorded never fails or undoes its change.
- **Privacy.** Notices and events carry role IDs, versions, hashes, request types, and agent IDs. They never carry role prose beyond the undo command's own words. Role names and descriptions are repository-local operational data, as `lervo role show` already reads them.
- **Failure codes:**
  - `agent_not_authorized`: the agent's role lacks the request type, or the agent is not active.
  - `role_built_in`: the role is one of Lervo's templates.
  - `role_exists`: the ID is taken.
  - `role_name_conflict`: another role has the name.
  - `role_extended`: another role extends it.
  - `role_in_use`: an agent that is not retired, or an assignment that has not ended, holds it.
  - `role_binding_blocked`: its agents cannot move to the new version, and the source was restored.
  - `role_not_found`: the role is not in this checkout.
  - `role_profile_invalid`: the words, request types, or source do not validate.

## Consequences

- A lead staffs a project with specialties as roles and people as names. Axli's four owners can move to project roles and take nicknames after the release.
- Authority to shape the organization stays in role contracts, visible and attributable.
- Removing a role takes a decision about its agents first. Lervo never makes that decision for them.
