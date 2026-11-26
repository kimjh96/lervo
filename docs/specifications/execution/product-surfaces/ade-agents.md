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

- **The sidebar.** Below the project switcher, "Agents" lists the selected project's team agents, each with its round mark, name, and role, in the order they were hired. A thin ring around an agent's mark shows its status: blue and breathing while one of its conversations works, amber and still while one needs the owner. Lervo's own agents do not show; one that stops or needs the owner surfaces through Lervo's health and attention reports. "Conversations" follows with the project's workspaces; its heading shows only over rows, so no heading stands over nothing. The agents show once the project's first list is known, and switching projects keeps the shown list until the next one arrives, then crossfades it (ADE craft rules, 13). The list reloads with the workspace lists, on every connection and after each change.
- **Hiring.** The plus beside "Agents" opens the interface's own menu directly below it (ADE craft rules, 10 and 15): each hireable role with one line on what it does, and "This Project" beside a repository role. A built-in role's line is a short summary in the ADE's message catalog; a project's own role shows the first sentence of its description. Choosing a role hires at once; the new agent appears in the list. Writing or changing roles is asked of the product owner or Lervo in a conversation, not edited in a form.
- **No agents yet.** A project without team agents shows one quiet row, "Hire a Product Owner", which hires one. It is offered, never required: the start card proposes a Product Owner anyway (ADR-0646).
- **Arrival.** An agent hired while the person watches arrives with the space it takes (ADE motion, principle 12); the agents of a project's first list are already there.
- **Failure.** A failed list or hire shows as one line under the list: "Lervo could not list or hire the agents (<code>)."

## Participants and sessions (slice 2)

- The start card's chip names the new conversation's participants, with their marks: the team's product owner by default. In a team without one, it proposes "Product Owner", which Lervo hires when the work starts and which then leads the conversation and appears in the sidebar; a hire that fails starts the work with the others or without an agent (ADR-0646). The chip opens the interface's own menu below it, the proposal first and then each team agent, as choices that toggle while the menu stays open; the last participant cannot be removed.
- `workspace.start` accepts `participants`, 1 to 8 distinct agent IDs of the project's active team agents (`participant_invalid` otherwise), and the core advertises `workspace.participants` so an older core is never sent it. The first participant writes; the others read or work under their own assignments (ADR-0222's one writer per worktree generation).
- The hosted launch record keeps `agentId`, the writing agent, and `participants`. The provider process's environment carries `LERVO_AGENT_ID`, at the start and when the conversation reopens, so hooks and turn evidence can attribute its work. The closed launch schema does not change; the variable rides the launch's environment.
- `workspace.list` reports each conversation's `agentId` and `participants`.
- The conversation's header shows the participants' marks, the writing agent first. An agent in the sidebar shows the status of the conversations whose session is its own: needs the owner when any does, working when any works.
- When the speaking agent changes, its mark, name, and role precede its turn; collaboration records, such as context passed between agents or paths claimed, show as quiet lines. These arrive with S2g, when more than one agent speaks in a conversation ([Lervo ADE rooms](ade-rooms.md)).

## The profile (slice 3)

- **Opening.** Choosing an agent in the sidebar shows its profile in the main area, in place of a conversation or the start screen, and the agent's row reads as current. Choosing a conversation, new work, or another project closes it.
- **Identity.** The agent's mark at its large size, its name, and its role. Pressing the name renames the agent in place through `agent.rename` (ADE craft rules, 12): the name becomes a field of the same type, Return or leaving the field renames, and Escape keeps the name.
- **Model and effort.** Two menus, the model from `agents.list`'s `models` and the effort, change them through `agent.model`. A line under them says whether Lervo chose them for the role and that a change applies from the agent's next session. A core that does not advertise `agent.model` shows the model as text.
- **Conversations.** The conversations the agent takes part in, as the lead or a joined participant; choosing one opens it.
- **Still to come.** The agent's paths, what it has learned, its image, and retiring it.
- **Failure.** A failed rename or model change shows one line under the profile: "Lervo could not change the agent (<code>)."

## Model and effort

- Each team agent runs on a model and at an effort its role chose when it was hired, and the owner can change both ([ADR-0647](../../../decisions/execution/orchestration/0647-choose-each-agents-model-and-effort-by-its-role.md)). The product owner starts on the strong model (Opus) at high effort, a developer on the strong model at extra-high effort, and a writer on the balanced model (Sonnet) at medium effort.
- `agents.list` reports each team agent's `model`: `tier`, `effort`, `source` (`role` or `owner`), and `displayName`, the provider's name for the tier's model. Lervo's own agents report none.
- `agent.model` (`projectId`, `agentId`, `revision`, `tier`, `effort`) sets them, as `lervo agent model` does, and returns the agent in the `agents.list` shape. The agent's next session runs with them; a running session keeps its model.
- `agents.list` also reports `models`, the provider's model for each tier with its name, most capable first, which the profile offers.
- `agent.rename` (`projectId`, `agentId`, `revision`, `name`) renames an agent in place, as `lervo agent rename` does, and records the existing `agent.identity.changed` event.
- `agent.status` (`projectId`, `agentId`, `revision`, `status`) pauses an agent (`suspended`) or lets it work again (`active`), as `lervo agent status` does. Retiring cannot be undone, so it stays a terminal command (invariant 10), and the core link refuses `retired` with `agent_argument_invalid`.
- The agent's profile (slice 3) shows the model and effort and changes them.

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
