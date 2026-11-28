# Lervo ADE agents

Status: `proposed`
As of: 2026-11-28

This specification defines S2c of [ADR-0637](../../../decisions/execution/applications/0637-build-projects-agents-and-conversations-in-the-ade-on-the-core.md): each project's agents in the ADE, hiring by role, and conversations that start with chosen agents whose sessions carry their identity. The owner approved the interface on 2026-11-26 (mockup "Lervo ADE · 프로젝트별 에이전트 (S2c)"). Every operation is a core command that the terminal can run too; the ADE calls it through the core link ([Lervo ADE core link](ade-core-link.md)).

Agents work together by mentioning each other directly, by role and by what each has learned. The product owner is not a router: an agent mentions the product owner only when its role, priorities and decisions, is needed ([ADR-0641](../../../decisions/coordination/conversations/agent-organization/0641-let-agents-mention-each-other-in-core-rooms-and-keep-their-own-context.md)). S2c gives sessions the identity that S2g's mentions need.

## Delivery

| Slice | Delivers                                                                                                                                                               |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | The sidebar's team, hiring by role, and "Hire a Product Owner" in a project without agents.                                                                            |
| 2     | A new conversation's participants, a hosted session that carries its writer agent's identity, participants in the conversation's header, and the speaker on each turn. |
| 3     | An agent's profile: its model, its conversations, its image, renaming in place, and pausing.                                                                           |

## Team agents and Lervo's agents

- A project's agents are its team agents: those the owner hired, Lervo's onboarding developer, and those team agents hired. Lervo's own agents, which maintain repository knowledge, are not the team and the sidebar does not show them ([ADR-0643](../../../decisions/execution/orchestration/0643-record-which-agents-are-lervos-own.md)).
- Each agent records its `origin`, `team` or `lervo`, when it is hired. Until a record carries it, the core applies ADR-0643's rule: the knowledge convergence delegation's parent and everything under it, the "Knowledge Steward" and everything under it, and convergence or practice workers by name (`Knowledge <role> <hash>`, `Practice <role> <hash>`) are Lervo's. The ADE never guesses from names.

## Core link

- `agents.list` (`project`) returns the project's active and suspended agents and the roles it can hire:
  - `agents`: each with `agentId`, `displayName`, `roleId`, `roleName`, `status` (`active` or `suspended`), `origin` (`team` or `lervo`), `provider`, `parentAgentId` (or null), and `revision`, in the order they were hired. Retired agents are not listed.
  - `roles`: each with `roleId`, `name`, `description`, and `source` (`built_in` or `repository`), in the order the role catalog lists them, then the template roles the project has not written yet, such as the product owner, so the hire menu can offer them.
- `agent.hire` (`project`, `role`, optional `name`) hires an agent for the owner, as `lervo agent hire --role <role> --provider claude --write` does: the product-owner role is written from its template first when the project has none, and the agent's responsibility paths are the whole repository. A hire without a name gets a nickname from Lervo's list that no agent of the project has, such as Bora, never its role's name ([ADR-0662](../../../decisions/coordination/conversations/agent-organization/0662-let-a-lead-shape-the-projects-roles-and-name-hires-like-people.md)). It returns the hired agent in the `agents.list` shape. Hiring is a workforce write under invariant 10: it happens at once and is recorded as the existing `agent.registered` event.
- A core link from an older release does not name these commands, and the ADE shows no agents.

## Roles

The built-in roles are Lervo's central templates. A project adds its own roles from them, edits them, and removes them ([ADR-0662](../../../decisions/coordination/conversations/agent-organization/0662-let-a-lead-shape-the-projects-roles-and-name-hires-like-people.md)). The ADE runs for the owner, who may always change roles; an agent changes them from its session only when its role carries `organization.coordinate` ([role contracts](../authority-and-repository/capability-decisions/role-contracts.md), "Project roles").

- `role.add` (`projectId`, `name`, `description`, `from`, optional `role`) adds a project role extending the `from` role, as `lervo role add` does, and answers `{projectId, role}` in the hire menu's shape. The ID derives from the name unless `role` names it.
- `role.edit` (`projectId`, `role`, optional `name` and `description`) writes the role's next version and moves its agents to it, as `lervo role edit` does, and answers `{projectId, role, changed}`. A template role the project has not written yet is written first.
- `role.remove` (`projectId`, `role`) removes a project role that no agent or open assignment holds, as `lervo role remove` does, and answers `{projectId, roleId}`.
- `agent.role` (`projectId`, `agentId`, `revision`, `role`) moves an agent to another role, keeping its ID, name, and context, as `lervo agent role` does, and answers `{projectId, agent}`. An active agent is paused for the move and works again after it.
- The ADE offers each of them only when the core advertises it.

## The ADE

- **The sidebar.** Below the project switcher, "Agents" lists the selected project's team agents, each with its round mark, name, and role, in the order they were hired. A thin ring around an agent's mark shows its status: blue and breathing while one of its conversations works, amber and still while one needs the owner. Lervo's own agents do not show; one that stops or needs the owner surfaces through Lervo's health and attention reports. "Conversations" follows with the project's workspaces; its heading shows only over rows, so no heading stands over nothing. The agents show once the project's first list is known, and switching projects keeps the shown list until the next one arrives, then crossfades it (ADE craft rules, 13). A list that fails is asked again after 1, 2, and 4 seconds; meanwhile a list of another project never stays shown under the asked one, so it neither shows nor joins a conversation there, and its failure shows only once the last try failed. Asking again, as returning to the project or the next reload does, starts over. On 2026-11-28 a project cloned a second earlier showed another project's five agents under a transient failure that the same request no longer had. The list reloads with the workspace lists, on every connection and after each change. When the project's list first arrives, the agents open their space as they fade in, together with the "Conversations" heading, so the rows below slide once (ADE motion, "Space").
- **Hiring.** The plus beside "Agents" opens the interface's own menu directly below it (ADE craft rules, 10 and 15): each hireable role with one line on what it does. The owner found a note marking a project's own role ("This Project") of no use and it was removed on 2026-11-28; `source` stays in `agents.list` for older session hosts. A built-in role's line is a short summary in the ADE's message catalog; a project's own role shows the first sentence of its description. Choosing a role opens the "Hire an Agent" sheet on it, and a core that advertises `role.add` ends the menu with "New Role" ([ADR-0662](../../../decisions/coordination/conversations/agent-organization/0662-let-a-lead-shape-the-projects-roles-and-name-hires-like-people.md)).
  - The sheet asks for the agent's name, a nickname such as Bora, and its role. An empty name lets the core pick a nickname.
  - "A new role", the role menu's last choice, asks for the role's name (its specialty, never a person), what it does, and the role it starts from, Developer unless the person picks another. Hire adds the role with `role.add` and then hires with `agent.hire`. A hire that fails after its role was added keeps that role chosen for the next try.
  - For a role the project wrote itself, "Edit Role" opens that role's sheet.
  - The sheet is a small glass window over Lervo, as "New Project" is. A failure shows its code in the sheet, which keeps what the person typed; the new agent appears in the list.
- **A role's sheet.** It changes the role's name and what it does through `role.edit`, for every agent with the role. "Remove Role" removes it through `role.remove`. The core refuses a role an agent or open work still holds (`role_in_use`), a role another role extends (`role_extended`), and a name another role has (`role_name_conflict`), and the sheet says the next step for each. Lervo's own templates have no sheet.
- **No agents yet.** A project without team agents shows one quiet row, "Hire a Product Owner", which hires one. It is offered, never required: the start card proposes a Product Owner anyway (ADR-0646).
- **Arrival.** An agent hired while the person watches arrives with the space it takes (ADE motion, principle 12); the agents of a project's first list are already there.
- **Failure.** A hire that fails, or a list whose last try failed, shows as one line under the list: "Lervo could not list or hire the agents (<code>)." A list that failed for a project the sidebar did not show yet shows the line alone, without agents. The session host's diagnostics log records the core's own code with each such failure ([session-host protocol](ade-session-host-protocol.md), "Privacy and failure").

## Participants and sessions (slice 2)

- The start card's chip names the new conversation's participants, with their marks: the team's product owner by default. In a team without one, it proposes "Product Owner", which Lervo hires when the work starts and which then leads the conversation and appears in the sidebar; a hire that fails starts the work with the others or without an agent (ADR-0646). The chip opens the interface's own menu below it, the proposal first and then each team agent, as choices that toggle while the menu stays open; the last participant cannot be removed.
- `workspace.start` accepts `participants`, 1 to 8 distinct agent IDs of the project's active team agents (`participant_invalid` otherwise), and the core advertises `workspace.participants` so an older core is never sent it. The first participant writes; the others read or work under their own assignments (ADR-0222's one writer per worktree generation).
- The hosted launch record keeps `agentId`, the writing agent, and `participants`. The provider process's environment carries `LERVO_AGENT_ID`, at the start and when the conversation reopens, so hooks and turn evidence can attribute its work. The environment also carries the Lervo state locations the core itself was started with, `LERVO_USER_STATE_DIRECTORY`, `LERVO_USER_CAPABILITY_ROOT`, and `LERVO_WORKSPACES_HOME`, when they are set. Without them, the session's own `lervo` commands would read a different registry than the core that started the workspace. The closed launch schema does not change; the variables ride the launch's environment.
- `workspace.list` reports each conversation's `agentId` and `participants`.
- The conversation's header shows the participants' marks, the writing agent first. An agent in the sidebar shows the status of its own sessions, in the conversations it leads and in those it joined: needs the owner when any does, working when any works. A conversation's row and the project switcher read every participant's session the same way. Before 2026-11-28 they read only the lead's session, so an agent that joined and worked showed nothing.
- When the speaking agent changes, its mark, name, and role precede its turn; collaboration records, such as context passed between agents or paths claimed, show as quiet lines. These arrive with S2g, when more than one agent speaks in a conversation ([Lervo ADE rooms](ade-rooms.md)).

## The profile (slice 3)

- **Opening.** Choosing an agent in the sidebar shows its profile in the main area, in place of a conversation or the start screen, and the agent's row reads as current. Choosing a conversation, new work, or another project closes it.
- **Role.** Under the identity, a menu of the project's roles moves the agent to another one through `agent.role`, and "Edit Role" opens the sheet of a role the project wrote itself. A line says that choosing another role pauses the agent for a moment and keeps its name and what it learned. A core that does not advertise `agent.role` shows the role as text only.
- **Identity.** The agent's mark at its large size, its name, and its role. Pressing the name renames the agent in place through `agent.rename` (ADE craft rules, 12): the name becomes a field of the same type, Return or leaving the field renames, and Escape keeps the name.
- **Model and effort.** Two menus, the model from `agents.list`'s `models` and the effort, change them through `agent.model`. A line under them says whether Lervo chose them for the role and that a change applies from the agent's next session. A core that does not advertise `agent.model` shows the model as text.
- **Conversations.** The conversations the agent takes part in, as the lead or a joined participant; choosing one opens it.
- **Pausing.** "Pause agent" sets the agent suspended through `agent.status`; it takes no new work, keeps its conversations, and shows quieter in the sidebar. "Resume agent" undoes it. Retiring cannot be undone, so the profile does not offer it (invariant 10); `lervo agent status` retires an agent.
- **Image.** Pressing the agent's large mark opens the image panel, as a project's logo does; an agent with an image first offers "Choose Image" and "Remove Image" in a menu. The image shows wherever the agent's mark does: the sidebar, the conversation's header, the speaker lines, the mention suggestions, and the participants chip.
- **What it has learned and the paths it holds** do not show. On 2026-11-28 the owner found the learned entries were whole final messages with their Markdown as raw text, and the paths internal write leases, neither of use to them. The core still answers `agent.context`, and the agent's own sessions still receive its notes ([Lervo ADE rooms](ade-rooms.md), "Memory from conversation").
- **Failure.** A failed rename or model change shows one line under the profile: "Lervo could not change the agent (<code>)."

## Model and effort

- Each team agent runs on a model and at an effort its role chose when it was hired, and the owner can change both ([ADR-0647](../../../decisions/execution/orchestration/0647-choose-each-agents-model-and-effort-by-its-role.md)). The product owner starts on the strong model (Opus) at high effort, a developer on the strong model at extra-high effort, and a writer on the balanced model (Sonnet) at medium effort.
- `agents.list` reports each team agent's `model`: `tier`, `effort`, `source` (`role` or `owner`), and `displayName`, the provider's name for the tier's model. Lervo's own agents report none.
- `agent.model` (`projectId`, `agentId`, `revision`, `tier`, `effort`) sets them, as `lervo agent model` does, and returns the agent in the `agents.list` shape. The agent's next session runs with them; a running session keeps its model.
- `agents.list` also reports `models`, the provider's model for each tier with its name, most capable first, which the profile offers.
- `agent.rename` (`projectId`, `agentId`, `revision`, `name`) renames an agent in place, as `lervo agent rename` does, and records the existing `agent.identity.changed` event.
- `agent.status` (`projectId`, `agentId`, `revision`, `status`) pauses an agent (`suspended`) or lets it work again (`active`), as `lervo agent status` does. Retiring cannot be undone, so it stays a terminal command (invariant 10), and the core link refuses `retired` with `agent_argument_invalid`.
- The agent's profile (slice 3) shows the model and effort and changes them.

## What an agent has learned

- `agent.context` (`projectId`, `agentId`) returns the agent's promoted context entries that are active and unexpired, newest first, at most 50: `entryId`, `layer`, `kind` (the memory kind), `subject`, `observedAt`, and `summary`, the entry's words read from the project's artifact store, at most 4,000 characters. A restricted entry's `summary` is null, so its words stay with the agent's own sessions, and a summary the store cannot read is null too. It reads the same projection as `lervo agent context inspect`, and an unknown agent fails with `agent_not_found`.
- It also answers the repository paths the agent holds under a live write lease, sorted, at most 100, with `pathsTotal` counting them all; a lease that expired, and a read lease, hold nothing. `changedPaths`, with `changedPathsTotal`, are the paths the conversations the agent leads changed and have not sealed yet, read from each led conversation's newest open generation without writing anything ([Lervo ADE coordination](ade-coordination.md)). A core that does not read leases answers no paths.
- The ADE's profile no longer reads it ("The profile").

## The agent's image

- An agent's image is bounded and stored as a project's mark is ([Lervo ADE projects](ade-projects.md)): PNG, JPEG, or WebP, at most 512 KiB, each side between 16 and 1,024 pixels, which the ADE prepares at most 512 pixels square. The bytes are stored once by their SHA-256 at `.lervo/assets/agents/<sha256>.<png|jpg|webp>`, a folder of its own, so a project changing its mark never removes an image an agent shows. The agent record keeps `mark` (`sha256`, `mediaType`), and an image no agent shows any longer is removed.
- `agents.list` reports each agent's `mark`, or null. `agent.mark.set` (`projectId`, `agentId`, `revision`, `data` in Base64) and `agent.mark.clear` (`projectId`, `agentId`, `revision`) change it and return the agent; `agent.mark.read` (`projectId`, `agentId`) returns the image's hash, format, and Base64 bytes, or null. `lervo agent mark --agent <id> (--image <file> | --clear) --revision <n> --write` does the same in the terminal.
- The ADE keeps a thumbnail of each image by its hash, in the same bounded cache as project marks, so an agent's image shows at once on the next launch.

## State, events, privacy, and failure meaning

- Slice 1 adds no stored state and no event type. `agents.list` reads the registry, the role catalog, and the convergence delegation. `agent.hire` records the existing `agent.registered` event.
- An image change records the existing `agent.identity.changed` with `changeKind: "mark"`, `previousMarkSha256`, and `markSha256` (each null when there is none). The image's bytes never enter an event.
- Agent names and role names are repository-local operational data, already readable by `lervo agent list`.
- Role changes add no event type. An edit's and a role move's agent transitions record the existing `agent.identity.changed` (`changeKind: role_binding`) and `agent.status.changed` events, and each role change records one effect notice ([ADR-0662](../../../decisions/coordination/conversations/agent-organization/0662-let-a-lead-shape-the-projects-roles-and-name-hires-like-people.md)).

| Code                        | Meaning                                                                     |
| --------------------------- | --------------------------------------------------------------------------- |
| `repository_not_registered` | No registry entry on this host has that project ID.                         |
| `role_not_found`            | The role is neither built in nor a repository role of the project.          |
| `agent_name_conflict`       | Another agent of the project already has that name, compared ignoring case. |
| `workforce_busy`            | The registry stayed locked by another writer after the core's retries.      |
| `agent_mark_invalid`        | The image's format, signature, size, or dimensions are outside the bound.   |
| `role_built_in`             | The role is one of Lervo's templates, which a project never changes.        |
| `role_exists`               | Another role already has that ID.                                           |
| `role_name_conflict`        | Another role already has that name, compared ignoring case.                 |
| `role_extended`             | Another role extends this one, so it cannot change or go.                   |
| `role_in_use`               | An agent that is not retired, or open work, holds the role.                 |
| `role_binding_blocked`      | The role's agents could not move to its new version; nothing changed.       |
| `role_argument_missing`     | A role command lacks a required argument.                                   |
| `role_argument_invalid`     | A role command's argument is empty or too long.                             |

## Open items

- Whether suspended agents show in the sidebar, dimmed, or only in the profile.
