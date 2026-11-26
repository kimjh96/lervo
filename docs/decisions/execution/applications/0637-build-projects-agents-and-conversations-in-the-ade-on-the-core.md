# ADR-0637: Build projects, agents, and conversations in the ADE on the core

Status: `accepted`
Decision date: 2026-11-26
Amends: [ADR-0632](0632-build-the-ade-as-the-platform-where-the-core-works.md) (orders the S2 steps after the day of use, and keeps one writer per worktree when several agents share a workspace), [ADR-0633](../providers/hooks/0633-record-a-linked-worktree-in-its-registered-repository.md) (an ADE workspace joins the workforce model once its session carries an agent), [ADR-0169](../../distribution/0169-user-local-repository-registration-and-resolution.md) (the registry also unregisters a project)
Related: [ADR-0205](../orchestration/0205-conflict-safe-repository-agent-workforce.md), [ADR-0222](../orchestration/0222-isolated-agent-workspace-lifecycle.md), [ADR-0386](../../coordination/conversations/0386-organization-teams-and-agent-identities.md), [ADR-0453](../../coordination/conversations/agent-organization/0453-act-for-the-owner-through-a-principal-mandate.md), [ADR-0454](../../coordination/conversations/agent-organization/0454-open-multi-responder-rooms-and-natural-staffing.md), [ADR-0560](../../foundation/0560-remove-unused-subsystems-to-harden-the-core.md), [ADR-0561](../../foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md), [ADR-0613](0613-host-provider-clis-in-a-first-party-development-environment.md)

## Context

On 2026-11-26, before leaving Orca, the owner raised five needs:

1. Projects cannot be added, renamed, or removed from the ADE.
2. A person with no project has no way in: there is no first run that sets up a project and checks Claude Code.
3. Git suits people working together over days. Agents work in minutes, in parallel, on the same files, so branches and pull requests become a bottleneck and conflicts surface late.
4. The sidebar lists every repository's workspaces at once, which leaves no room for agents, mentions, and their conversations.
5. A project should hire a product owner or leads, show its agents live, let a conversation choose its agents, and show the people and agents taking part, each with a profile.

The owner also wants an optional logo per project, shown as its first letter without one. Role management ([ADR-0639](../orchestration/0639-manage-roles-in-the-core-with-authority-apart.md)) and a cloud future, with the knowledge Lervo accumulates ([ADR-0638](../../foundation/0638-keep-lervo-local-first-and-open-to-the-cloud.md)), are set apart.

What the core has today:

- **Projects.** The registry is this device's index of where each project lives; a project's identity is the `projectId` in `.lervo/project.yaml` (ADR-0169). Only `register` changes the registry, and `resolve` requires the exact manifest name and hash, so any change to `.lervo/project.yaml` leaves the entry stale (`repository_registration_stale`) on every host until it registers again. Workspace launch, hooks, and hosted usage records resolve through it. The manifest schema allows no extra properties. The core link answers `repository.list` with each project's ID and name.
- **Onboarding.** `lervo init` writes the project files and hires a first developer unless `--minimal` is given, and registers the folder only under a knowledge-continuity policy. `lervo doctor` checks a provider CLI's presence and version, never its sign-in. `provider_login_unavailable`, a `request.failed` code meaning the provider CLI reports no one signed in, is emitted by nothing.
- **Coordination.** Path leases block their ancestors, and `.` and `*` overlap every path (ADR-0205). A write-capable assignment gets its own worktree generation with exactly one writer session, and one integration agent moves the target ref under an exclusive lease (ADR-0222); no command runs integration. ADE workspaces use none of it: ADR-0633's workspace has no agent, assignment, or lease.
- **Agents.**
  - Agents are hired with versioned roles from seven built-in templates (ADR-0209). This repository's `product-owner` role extends `ceo` and may hire and delegate; a new project has none.
  - Agent records live in the Git common directory (`lervo-coordination-v1/workforce/agents.json`), uncommitted and never rebuilt from replicated events, so each clone keeps its own.
  - Each agent has a four-layer context namespace (ADR-0386). On 2026-11-26 this clone had 13 active agents and no entries: apart from the Discord runtime's `work_outcome` entries, entries arrive only through `lervo agent context promote`, and ADE sessions carry no agent.
  - The product owner hires within headcount without asking; past the escalation bound, a hire beyond it is held as Lervo debt (ADR-0453, as amended by ADR-0561).
- **Rooms.** ADR-0454's rooms, mentions, discussions, natural staffing, and memory from conversation are accepted but not implemented. The Discord runtime that ADR-0560 kept answers each turn with a single owner, suppresses mentions, and writes only `work_outcome` memory. The core has no conversation model the ADE can read.

## Decision

### The project is the ADE's top-level scope

- A project is a Lervo project, identified by its `projectId`. The registry entry records where it lives on this host. It never identifies the project, and its absolute root stays local operational data (ADR-0169). For now one project is one repository.
- The ADE shows one project at a time.
  - A switcher at the top of the sidebar lists the registered projects with their marks, adds a project, and shows when another project needs the owner, so filtering never hides attention.
  - Below the switcher, the sidebar lists the project's agents with their status, then its conversations.
- A project's display name and mark live in a Lervo-managed profile file under `.lervo/`, apart from `.lervo/project.yaml`. Changing them is a repository write, but it changes neither the manifest nor its hash, so no host's registry entry goes stale and older CLIs, which never read the file, are unaffected. Without a profile, the manifest name shows.
- The core adds the operations the ADE calls:
  - **Rename** writes the display name to the profile.
  - **Unregister** removes this host's registry entry only. It never touches the project's files, worktrees, or state. This amends ADR-0169, where only `register` changed the registry.
  - The core link extends `repository.list` with each project's display name and mark, and adds commands to add, rename, and unregister a project and to set its mark.

### Projects and agents carry one identity mark

- A mark is an optional image, with a first letter on a color derived from the ID when no image is set.
- A project's image is stored once, under `.lervo/`, by its SHA-256, and the profile names that hash. Every clone shows the same mark through Git. A Hub holds no repository files, so it shows a mark only once project profiles replicate, which is designed with accounts.
- An agent's image is named the same way in its agent record.
- Accepted formats are PNG, JPEG, and WebP within a size bound that the specification sets. SVG is refused because it can carry script.

### First run asks only for what Lervo cannot find out

There is no onboarding screen. The first run is the start screen itself (owner review of the quiet mockup, 2026-11-26).

- With no project registered, the start card takes any of three things, and each becomes a project in one action. Nothing is uploaded: a project stays where its files are.
  - An existing folder, dropped or chosen.
  - A repository link, which the core clones into the owner's projects location (`~/Lervo` until the owner chooses another in the card).
  - An instruction alone, for which the core creates a new folder in that location, named from the instruction, and starts the conversation in it.
- The resulting project:
  - Its name is the folder's name, and its mark is its first letter. Both change later in place.
  - The core registers the folder, whatever the host's continuity policy. It runs `lervo init` when the folder has no `.lervo/project.yaml` and `git init` when the folder is not a Git repository. The project appearing in the switcher is the confirmation; only a failure shows a line.
- Environment checks run quietly: the Lervo CLI, the session host, and each provider CLI, installed and signed in. Only a check that blocks work shows, as one line under the card with one action. The core reports sign-in through `provider.list` and emits `provider_login_unavailable` when the provider CLI reports that no one is signed in.
- Hiring a product owner is offered in the sidebar, never required. The product owner then staffs within headcount (ADR-0453, ADR-0454). The core ships `product-owner` as a built-in role, taken from this repository's role, so every project can hire one.
- Projects are managed where they are listed. Adding opens the system's folder picker, a name is edited in place, a mark is chosen by clicking it, and removal sits in the context menu, which says that files stay. There is no settings page.

### Roles are managed in the core

Roles are managed in the core, with their authority handled apart from their wording ([ADR-0639](../orchestration/0639-manage-roles-in-the-core-with-authority-apart.md)). The ADE shows them where an agent is hired, and roles are written by asking an agent or Lervo.

### ADE work joins the workforce model

- An ADE workspace keeps its worktree, branch, and workstream (ADR-0633). Once S2c lands, it also gains three things:
  - Its session carries an agent identity.
  - Its writes hold an assignment with a path lease (ADR-0205).
  - Its worktree is a workspace generation under ADR-0222.
- ADR-0222 holds: one writer session per worktree generation. When several agents take part in one workspace, as ADR-0632 requires, one of them writes, and each other agent either reads only or writes in its own generation under its own assignment and lease.
- A conversation's work does not know its paths up front, and a lease on `.` or `*` would block every other agent. The S2c and S2h specifications therefore define leases that grow with the work: a path is claimed when the session first writes to it, and a conflicting claim stops that write and tells the agent.
- The S2c specification settles, before any code changes, how ADR-0633's two roots apply to a workspace generation, and how a worker binding's effects on owner capture and on Stop apply to ADE sessions.

### Coordination moves to the workstream

Git stores and publishes, and coordination between agents moves to the workstream, with leases that grow with the work and integration in small steps ([ADR-0640](../orchestration/0640-coordinate-agents-in-the-workstream-and-let-git-store-and-publish.md)).

### Agents talk in core rooms and keep their own context

A conversation is a core room with participants. Agents mention each other by role and by what they have learned, and each keeps its own context from that work ([ADR-0641](../../coordination/conversations/agent-organization/0641-let-agents-mention-each-other-in-core-rooms-and-keep-their-own-context.md)).

### Local first, open to the cloud

Everything here works on a node without a Hub. Knowledge scopes, the Hub and node roles, and the constraints that keep a cloud Hub or cloud nodes possible are set in [ADR-0638](../../foundation/0638-keep-lervo-local-first-and-open-to-the-cloud.md).

### Order

The S2 steps after the day of use run in this order. Orca retires after the day of use and does not wait for them. S2d (Lervo tools) and S2e (hosted observations) keep their place in ADR-0632 and run alongside.

1. **S2f, projects and the first run.**
   - Core: the project profile, unregister, the sign-in check, project marks, `product-owner` as a built-in role.
   - ADE: the switcher with in-place management, and the first run on the start screen.
2. **S2c, agent identity.**
   - Sessions carry an agent, and the workspace holds an assignment and a growing lease.
   - Agents get marks, and roles show when hiring.
   - A new conversation chooses its agents, and participants show.
3. **S2g, rooms.**
   - The core conversation model, the team room, mentions, and memory from conversation.
4. **S2h, coordination.**
   - The coordination specification, then the integration command, then the ADE driving integration.

## State, events, privacy, and failure meaning

Each step defines its new events and states, with required fields, privacy handling, and failure meaning, in its specification before it ships. These constraints hold for all of them:

- Registry changes stay local operational data. Absolute roots never enter events, receipts, Hub replication, or prompts (ADR-0169).
- A project rename and a mark change are repository writes. They follow invariant 10: cross-checked, reversible, and reported after the fact.
- Mark images are user content. They are stored by hash and refused when their format or size is invalid (`project_mark_invalid`).
- `provider_login_unavailable` means the provider CLI reports that no one is signed in. The ADE shows it as one line under the start card.

## Consequences

- The sidebar shows one project with its agents and conversations, and the core gains project operations and a conversation model the terminal can use too (ADR-0632, foundation 6).
- ADE work enters the workforce's coordination, and hired agents start to accumulate context from it.
- Nothing here assumes a cloud, and nothing prevents one.

## Verification

- **S2f.**
  - On a host with no registered project, the start card offers to drop or choose a folder.
  - Adding a folder without `.lervo/project.yaml` initializes and registers it, and the project appears in the switcher with its mark.
  - A repository link clones into the projects location, and an instruction alone creates a new project there and starts its conversation.
  - Renaming the project changes its profile and the switcher on this host, and on another host after it pulls, with both registry entries still resolving.
  - Unregistering removes it from the switcher and leaves every file in place.
  - With the provider signed out, one line under the start card reports `provider_login_unavailable` with its action.
  - A new project can hire a product owner.
- **S2c.** ADR-0632's check: two hosted sessions with different agents run in one workspace, each with its own identity and lease, and only one of them writes in a worktree generation. A path one session writes cannot be written by the other. A new conversation chooses its agents, and they show as participants.
- **S2g.** Without the owner, an agent mentions another agent whose role or context its work needs, and the turn reaches that agent through core records. The team room shows both turns. After the turn, the mentioned agent has a memory-from-conversation entry.
- **S2h.** Two agents claiming overlapping paths conflict at claim time. A sealed change integrates through the integration command and reaches people as one pull request.
