# ADR-0638: Keep Lervo local first and open to the cloud

Status: `accepted`
Decision date: 2026-11-26
Part of: [ADR-0637](../execution/applications/0637-build-projects-agents-and-conversations-in-the-ade-on-the-core.md)
Related: [ADR-0169](../distribution/0169-user-local-repository-registration-and-resolution.md), [ADR-0386](../coordination/conversations/0386-organization-teams-and-agent-identities.md), [ADR-0467](../knowledge/documents/0467-capture-owner-turns-semantically-in-the-knowledge-resident.md)

## Context

On 2026-11-26 the owner said Lervo may later run with a cloud Hub, or entirely in the cloud, behind a subscription, and that the knowledge Lervo accumulates, including what hired agents learn, must be part of that picture.

Today every machine the owner uses is a node, and the owner's WSL also runs the Hub. Repository knowledge lives in repository files. Events and workstreams replicate per repository through the Hub when a project allows it (`hubSyncEnabled` in `.lervo/project.yaml`). Agent records live in each clone's Git common directory and are not replicated. ADR-0467 keeps the owner's personal preferences (`preference_personal`) out of shared knowledge, and no store holds them.

## Decision

### Knowledge has three scopes

| Scope           | What it holds                                                              | Original                                     | How it travels                                                       |
| --------------- | -------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------- |
| Repository      | Owner rules, decisions, specifications, skills, the project profile        | Repository files                             | Git                                                                  |
| Project records | Events and workstreams; agent records and context once S2c replicates them | The node's local state                       | Replicated per repository through a Hub when `hubSyncEnabled` allows |
| Personal        | The owner's preferences across projects (ADR-0467's `preference_personal`) | A new user-scoped store of files on the node | Through a Hub, encrypted; designed later                             |

Personal knowledge never enters project or team knowledge (ADR-0467). A preference the owner wants a project to follow becomes an owner rule of that project, stated as one.

### Local first, open to the cloud

- **Hub and node are roles.**
  - A node does the work: sessions, hooks, the context server, the knowledge resident, and tests.
  - A Hub keeps and relays the records that nodes replicate, and relays signed commands. It never runs agents or changes code.
  - One machine may hold both roles. The owner's WSL does today.
- A node works without a Hub (invariant 1), and a Hub never becomes the only original of what a node writes.
- Projects, agents, conversations, and workstreams are identified by IDs, never by paths. Every session, workspace, and lease records its host.
- Images and other assets are content-addressed, so replication copies them by hash.
- The session-host protocol stays independent of its transport. Remote access adds authentication and encryption at the transport.
- The account or organization that owns a project is added with accounts. Readers learn the field before any writer sets it.
- Provider credentials stay on the node unless a person places them elsewhere.
- Entitlements, such as a subscription, are checked only by a Hub or cloud service, never on a node's local path.
- File attachments by path (Lervo ADE sessions, "Files in a message") reach only a session on the same node. A remote node needs an upload.

## Consequences

- The projects, agents, and conversations ADR-0637 adds assume no cloud and prevent none.
- A cloud Hub is the first cloud step: it replicates what nodes already write, and a subscription can start there without touching a node's local path.
- Running agents in the cloud adds a node, not a new kind of system.
