# Lervo ADE agents

Status: `proposed`
As of: 2026-11-26

This specification defines S2c of [ADR-0637](../../../decisions/execution/applications/0637-build-projects-agents-and-conversations-in-the-ade-on-the-core.md): each project's agents in the ADE, hiring by role, and conversations that start with chosen agents whose sessions carry their identity. The owner approved the interface on 2026-11-26 (mockup "Lervo ADE · 프로젝트별 에이전트 (S2c)"). Every operation is a core command that the terminal can run too; the ADE calls it through the core link ([Lervo ADE core link](ade-core-link.md)).

Agents work together by mentioning each other directly, by role and by what each has learned. The product owner is not a router: an agent mentions the product owner only when its role, priorities and decisions, is needed ([ADR-0641](../../../decisions/coordination/conversations/agent-organization/0641-let-agents-mention-each-other-in-core-rooms-and-keep-their-own-context.md)). S2c gives sessions the identity that S2g's mentions need.

## Delivery

| Slice | Delivers                                                                                                                                                               |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | The sidebar's team, hiring by role, and "Hire a Product Owner" in a project without agents.                                                                            |
| 2     | A new conversation's participants, a hosted session that carries its writer agent's identity, participants in the conversation's header, and the speaker on each turn. |
| 3     | An agent's profile: what it works on, its paths, what it has learned, its image, renaming in place, and retiring.                                                      |

## Team agents and Lervo's agents

- A project's agents are its team agents: those the owner hired, Lervo's onboarding developer, and those team agents hired. Lervo's own agents, which maintain repository knowledge, are not the team and the sidebar does not show them ([ADR-0643](../../../decisions/execution/orchestration/0643-record-which-agents-are-lervos-own.md)).
- Each agent records its `origin`, `team` or `lervo`, when it is hired. Until a record carries it, the core applies ADR-0643's rule: the knowledge convergence delegation's parent and everything under it, the "Knowledge Steward" and everything under it, and convergence or practice workers by name (`Knowledge <role> <hash>`, `Practice <role> <hash>`) are Lervo's. The ADE never guesses from names.

## Core link

- `agents.list` (`project`) returns the project's active and suspended agents and the roles it can hire:
  - `agents`: each with `agentId`, `displayName`, `roleId`, `roleName`, `status` (`active` or `suspended`), `origin` (`team` or `lervo`), `provider`, `parentAgentId` (or null), and `revision`, in the order they were hired. Retired agents are not listed.
  - `roles`: each with `roleId`, `name`, `description`, and `source` (`built_in` or `repository`), in the order the role catalog lists them, then the template roles the project has not written yet, such as the product owner, so the hire menu can offer them.
- `agent.hire` (`project`, `role`, optional `name`) hires an agent for the owner, as `lervo agent hire --role <role> --provider claude --write` does: the product-owner role is written from its template first when the project has none, the name is generated when none is given, and the agent's responsibility paths are the whole repository. It returns the hired agent in the `agents.list` shape. Hiring is a workforce write under invariant 10: it happens at once and is recorded as the existing `agent.registered` event.
- A core link from an older release does not name these commands, and the ADE shows no agents.

## The ADE

- **The sidebar.** Below the project switcher, "Agents" lists the selected project's team agents, each with its round mark, name, and role, in the order they were hired. A dot shows an agent's status once sessions carry agents (slice 2): working, or needs the owner. Lervo's own agents do not show; one that stops or needs the owner surfaces through Lervo's health and attention reports. "Conversations" follows with the project's workspaces; its heading shows only over rows, so no heading stands over nothing. The agents show once the project's first list is known, and switching projects keeps the shown list until the next one arrives, then crossfades it (ADE craft rules, 13). The list reloads with the workspace lists, on every connection and after each change.
- **Hiring.** The plus beside "Agents" opens the interface's own menu directly below it (ADE craft rules, 10 and 15): each hireable role with one line on what it does, and "This Project" beside a repository role. A built-in role's line is a short summary in the ADE's message catalog; a project's own role shows the first sentence of its description. Choosing a role hires at once; the new agent appears in the list. Writing or changing roles is asked of the product owner or Lervo in a conversation, not edited in a form.
- **No agents yet.** A project without team agents shows one quiet row, "Hire a Product Owner", which hires one. It is offered, never required: a conversation still starts, with a developer as its participant (slice 2).
- **Arrival.** An agent hired while the person watches arrives with the space it takes (ADE motion, principle 12); the agents of a project's first list are already there.
- **Failure.** A failed list or hire shows as one line under the list: "Lervo could not list or hire the agents (<code>)."

## Participants and sessions (slice 2)

- The start card's chip names the new conversation's participants: the product owner by default, or a developer in a project without one. It opens a menu of the project's team agents to choose several.
- `workspace.start` accepts `participants`, agent IDs of the project's active team agents, advertised as a core request name so an older core is never sent it. The first participant writes; the others read or work under their own assignments (ADR-0222's one writer per worktree generation).
- The hosted session carries its writer agent in the hosted launch record and in `LERVO_AGENT_ID` in the provider process's environment, so hooks and turn evidence attribute its work. The closed launch schema does not change.
- The conversation's header shows the participants' marks. When the speaking agent changes, its mark, name, and role precede its turn. Collaboration records, such as context passed between agents or paths claimed, show as quiet lines.

## State, events, privacy, and failure meaning

- Slice 1 adds no stored state and no event type. `agents.list` reads the registry, the role catalog, and the convergence delegation. `agent.hire` records the existing `agent.registered` event.
- Agent names and role names are repository-local operational data, already readable by `lervo agent list`.

| Code                        | Meaning                                                                     |
| --------------------------- | --------------------------------------------------------------------------- |
| `repository_not_registered` | No registry entry on this host has that project ID.                         |
| `role_not_found`            | The role is neither built in nor a repository role of the project.          |
| `agent_name_conflict`       | Another agent of the project already has that name, compared ignoring case. |
| `workforce_busy`            | The registry stayed locked by another writer after the core's retries.      |

## Open items

- How an agent's image is stored and replicated, which slice 3 settles with the project mark's approach.
- Whether suspended agents show in the sidebar, dimmed, or only in the profile.
