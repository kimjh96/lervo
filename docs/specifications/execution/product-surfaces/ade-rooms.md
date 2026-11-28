# Lervo ADE rooms

Status: `proposed`
As of: 2026-11-27

This specification defines S2g of [ADR-0637](../../../decisions/execution/applications/0637-build-projects-agents-and-conversations-in-the-ade-on-the-core.md): conversations where agents mention each other and the owner watches them work together. It implements [ADR-0641](../../../decisions/coordination/conversations/agent-organization/0641-let-agents-mention-each-other-in-core-rooms-and-keep-their-own-context.md) as amended by [ADR-0644](../../../decisions/coordination/conversations/agent-organization/0644-keep-agent-coordination-in-conversations.md). There is no team room; a mention stays in the conversation where it was made. The owner approved the interface on 2026-11-26 (mockup "Lervo ADE · 에이전트끼리 멘션하는 대화 (S2g)").

Agents mention each other directly, choosing by role and by what each has learned. The product owner is not a router: an agent mentions it only when its role, priorities and decisions, is needed.

## Delivery

| Slice | Delivers                                                                                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Mentions inside a conversation: each participant's own session, the owner's and agents' mentions, joining by mention, one timeline with speaker lines, and the exchange budget. |
| 2     | Mentions across conversations, the quiet line in the mentioned agent's own conversation, and conversations an agent starts.                                                     |
| 3     | Memory from conversation: a note after each published turn, and the roster each session sees naming what each agent knows.                                                      |

## Participants and their sessions

- A conversation is a workspace with participants ([Lervo ADE agents](ade-agents.md), "Participants and sessions"). The first participant leads: its session writes in the worktree. Every other participant gets its own hosted session in the same worktree when it is first addressed, with read access only. Writing beyond the lead waits for S2h's claims.
- Rooms need the native conversation mode, where the core decodes each session's output. A conversation in terminal mode keeps one agent.
- An agent's session carries its identity (`LERVO_AGENT_ID`) and its own context, so each agent answers from what it has seen and learned rather than from a shared transcript.
- Each participant's session has its own hosted launch record, with `agentId` and, for an agent that joined, `access: read`. The lead's record alone continues the conversation, so a joined agent's newer record never reopens as the conversation. `workspace.list` reports `participants`, those the conversation started with and then those who joined, and `sessions`, each with `agentId`, `sessionId`, and `access`, the lead's first. A conversation holds at most 16 agents.

## Routing

- **The owner's turn.** A turn that mentions agents goes to each mentioned agent. Any other turn goes to the lead. A mentioned agent that is not a participant joins first.
- **An agent's turn.** When an agent's turn ends, the core reads its final message for mentions. Each mentioned agent receives one turn: who mentioned it, the message, and the conversation's turns since that agent last spoke, at most 8 turns and 16 KiB. A mentioned agent that is not a participant joins first.
- **Replies.** The answer to an agent's mention returns to the agent that mentioned, as a turn, even when the answer mentions no one. Naming the agent that asked is the answer to it, never a new question back. A turn that first asks another agent keeps the answer owed, and the agent's next turn that asks no one answers everyone still waiting. An owner's mention needs no return.
- **A busy agent.** A delivery to an agent whose turn is running waits and goes when that turn ends, in the order the deliveries were made.
- **What a mention is.** `@` followed by the display name of an active team agent of the project, matched without regard to case, at a word boundary, outside code spans and code blocks. Any other `@` text stays text. Lervo's own agents are never mentioned.
- **Bounds.** Agent-to-agent deliveries in one conversation are bounded by ADR-0454's exchange budget, 12 in 10 minutes, and by a depth of 8 from the turn that started the chain. An owner turn resets both. When a bound is reached:
  - the conversation shows that agents paused;
  - the agent that started the exchange receives one more turn, to summarize it;
  - whatever is left open becomes a decision for the product owner, or Lervo debt when no product owner is hired, and never waits on the owner.

## What each session knows

- At its start and at each turn, Lervo's hook context gives the session a room block:
  - who it is;
  - the conversation's participants;
  - the project's team agents with their roles and IDs;
  - how a mention works: write `@Name` when the work needs that agent's role or knowledge, and its answer comes back as a turn.
  - that an agent it mentions joins able to read and answer, never to change files; and, in a session that joined by a mention, that the session reads only, so a request that needs changes belongs in a conversation the agent starts and leads, never in a request for write permission;
  - how to start a conversation, for itself or handed to the teammate whose work it is with `--lead`, and that each owner's work goes to that owner rather than being done by the agent itself (ADR-0657);
  - that work is handed over and asked for only through Lervo's commands and mentions, never through a provider's own messages to another session, and that no agent stops a process Lervo runs.
- From slice 3, the block also says what each other agent knows from its reviewed expertise, so an agent can pick "the researcher who studied this API last week" by name. It never carries another agent's conversation notes: a session's block recalls only its own agent's notes ([ADR-0648](../../../decisions/coordination/conversations/agent-organization/0648-attest-a-conversation-note-by-its-delivery-receipt.md)).

## The core link and the session host

The resident core decodes every hosted session's output, so it sees each turn end without a new channel. Deliveries ride the decoder's answers, and the session host performs them.

- **Deliveries.** `decoder.decoded` gains `deliveries`, each with:
  - `deliveryId`;
  - `workspaceId`;
  - `agentId`;
  - `sessionId`, which is null when the agent has no session yet;
  - `text`.

  For each delivery, the session host:
  1. Opens the agent's session if it has none, from the launch that `room.join` prepares.
  2. Queues the text behind a running turn.
  3. Encodes the text through `decoder.send` and writes it to the session.
  4. Answers `room.delivered` with the `deliveryId`, or `room.failed` with the `deliveryId` and a code.

- **Joining.** `room.join` (`workspaceId`, `agentId`) prepares a read-access launch for an agent in the conversation's worktree, records it in the launch record's `sessions`, and returns the launch. For the lead of a conversation it started, whose session has not opened, it returns the lead's prepared write launch with `lead: true` (slice 2).
- **The owner's turn.** `room.route` (`workspaceId`, `text`) answers the agent IDs the turn goes to, in order: the mentioned agents, or the lead. The ADE sends the turn to each through `session.send`, as it sends one today, joining first where needed.
- **Echoes.** A delivered turn reaches the recipient's stream as its user message. The core's decoder for that session knows the delivery it encoded and decodes the echo as a `peer_message` whose `from` is the mentioning agent's display name, never as the owner's message.
- **Room lines.** The core adds `lervo_notice` items to the conversation for what the room does:
  - `room_joined`, with the agent and the agent who mentioned it. An owner's own mention adds no line: the header gains the agent's mark and its speaker line introduces it, so a line would only repeat what the owner just did;
  - `room_paused`, with the turn count and limit;
  - `room_delivery_failed`, with the agent and a code.
- **Advertising.** The core advertises `room.route`, `room.join`, and `decoder.deliveries`. The session host and the ADE use none of them with a core that does not, and an older ADE sees one-agent conversations as before.

## The ADE

- **One timeline.** The conversation opens every participant's session and shows their items in one timeline, ordered by `createdAtMs`. A `peer_message` that a delivery produced does not show, because the mentioning message it repeats already does. The owner's turn sent to several agents shows once.
- **Speakers.** When the speaking agent changes, a line with its mark, name, and role precedes its turn. A conversation with one agent looks as it does today. Marks appear only where an agent is named, speaks, or works (ADE craft rules, 20).
- **Mentions.** A mention of a team agent, in the owner's turn or an agent's, shows as a quiet pill: the name in the link color on a faint accent fill, a step heavier than the text, exactly where the core would deliver it. Other `@` text stays text. Room lines read as quiet lines without a mark: "Arin joined · mentioned by Ciel", "Agents paused after 12 turns in 10 minutes", and "Lervo could not deliver Ciel's mention to Tarin (agent_suspended)".
- **The header** shows the participants' marks, the lead first, and gains a mark when an agent joins.
- **The working line** keeps one row. In a conversation of several agents at work, it names each working agent and what it does, such as "Ciel · Editing retry.ts, Arin · Reading"; with the lead alone at work, it reads as before.
- **The owner's mentions.** Typing `@` in the reply card offers suggestions above the card, at the caret's left, while the field keeps the focus: the conversation's participants first, then the other team agents, "joins when mentioned". Typing narrows the list, Up and Down move, Return or Tab chooses, and Escape closes it. Choosing writes `@Name `, and every mention in the field shows as the same pill as in the conversation, drawn behind the field's own text so the caret and the selection stay the field's.

## Across conversations and agent-started conversations (slice 2)

- **Mentioning across conversations.** A mentioned agent that works in another conversation joins this one with a new session here; its session there continues undisturbed. Its own conversation gains one quiet line, "Ciel answered Iris in Log format", which opens the answer.
  - The ADE reads the line from the core's `room.answers`, which answers from the rooms' schema-15 records. The answers are the mentions delivered to the conversation's lead in other conversations, newest first, at most 50.
  - The ADE reads again whenever the lead's session changes status. It places each line at its delivery's time in the timeline, and its title opens the other conversation. An answer outside the loaded pages waits until a page reaches it.
  - A repository below schema 15 has no records and shows no line. The ADE asks only a core that advertises `room.answers`.
- **Agent-started conversations.** Work that is an agent's own and belongs apart from the conversation it is in, such as a fix it found while reviewing, gets a conversation the agent starts and leads ([ADR-0644](../../../decisions/coordination/conversations/agent-organization/0644-keep-agent-coordination-in-conversations.md)). Nothing waits on the owner.

### How an agent starts a conversation

1. **The command.** In its session, the agent runs `lervo workspace start --repository <project> --started-by <agent> [--lead <teammate>] --title <title> --json`, with the first turn on standard input, as the room block tells it with its own IDs and the team's filled in.
   - Without `--lead`, the agent leads. With it, the agent hands the conversation to the teammate whose work it is ([ADR-0657](../../../decisions/coordination/conversations/agent-organization/0657-let-an-agent-hand-work-to-a-teammates-own-conversation.md)).
   - The command prepares the worktree and the lead's write launch, with the lead as the only participant, and records `startedBy` in the hosted launch record.
   - It opens no session. It records a pending start that holds the first turn until the session opens: the lead as `agentId`, and the starter as `startedBy` when the starter is not the lead. It returns the new conversation's workspace ID.
   - A read-access session's allowlist admits the command, since it changes no file in the worktree.
2. **The guard.**
   - `--started-by` and `--lead` must each name an active team agent of the project (`participant_invalid`).
   - `--started-by` must equal the calling session's `LERVO_AGENT_ID` (`agent_not_caller`), so an agent starts conversations only as itself, for itself or for any teammate.
   - An agent starts at most 12 conversations an hour (`conversation_start_limited`). This is a backstop that keeps a runaway loop from filling the sidebar, never a gate on handing work out (ADR-0657).
3. **The delivery.** When the starting agent's turn ends, the core reads the pending starts that agent made and adds one delivery for each: the new `workspaceId`, the lead, no session, the first turn as the starter's message, and the calling session as the source. A handed conversation's first turn tells the lead that it leads, changes the files, and mentions the starter when it needs it or when the work is done. The source conversation shows a quiet line, "Ciel started Fix retry budget", which opens the new conversation.
4. **The lead's session.** For a delivery to the lead of a conversation that started for it, which has no session yet, `room.join` returns the prepared write launch with `lead: true` instead of preparing a read-access one. The session host starts it as the workspace's own session, with the delivery as its first turn, so the owner opening the conversation finds it already running.
5. **What the new conversation shows.** A quiet line, "Started by Ciel in Log format", which opens that conversation, and then the first turn as Ciel's message under Ciel's speaker line. The sidebar lists the conversation like any other, by its title.

A start that fails after the command returned shows in the source conversation as "Lervo could not start Ciel's conversation (<code>)", and the pending start is dropped. A pending start whose source session ended before its turn ended is delivered at the next turn end of any of the agent's sessions, or dropped after an hour.

## Memory from conversation (slice 3)

- After each turn an agent publishes in a conversation, the agent records a `conversation_note`, its own summary of what it committed to, learned, or decided, as ADR-0454 defines:
  - at most 512 characters;
  - agent-scoped and non-canonical;
  - expires after 30 days.

  Event schema 16 adds this kind to `agent.context.promoted` before any writer emits it; older envelope versions refuse it ([event envelope compatibility](../events-and-privacy/event-envelope-compatibility.md)).

- A note is attested by its delivery's receipt rather than by a review of its words ([ADR-0648](../../../decisions/coordination/conversations/agent-organization/0648-attest-a-conversation-note-by-its-delivery-receipt.md)). In v1 only a turn delivered to the agent by another agent's mention writes a note. An owner's direct turn to the lead has no receipt and writes none. A note stays with its own agent and reads as its own.

- **The writer.** When a delivered turn ends, the resident's room router hands the turn's last published message to the note writer, off the turn's answer path.
  - The message is the agent's own final text, never tool output. The writer drops its fenced code blocks and quoted lines, so a note never repeats another agent's words verbatim. It then collapses the whitespace and cuts the text at a word within 512 characters. A message with nothing left writes no note.
  - It promotes the result as the agent's `conversation_note` through the same path `lervo agent context promote` takes.
  - The note's subject is `conversation/<conversation>/<mention>`, and its source and review are the delivery's `room.mention.delivered`. It expires after 30 days.
  - The writer records nothing below event schema 16. It gives up after 10 seconds, and a note its receipt cannot attest yet is not written. None of these changes the turn.

- Reviewed decisions and feedback reach the agent's expertise layer through the knowledge resident, as ADR-0641 sets. The room block reads both. A session's block recalls its own agent's three newest notes, labeled as notes it wrote itself and no one reviewed. The recalled notes take at most 2,048 bytes, and the block waits at most one second for them before the session starts without them. A note reaches only its own agent: its profile, its block, and its materialized context. The repository's compact context, which every session receives, never reads agent context.

## State, events, privacy, and failure meaning

- **State.** Rooms keep host-local operational state beside the hosted launch records:
  - the launch record's `sessions`;
  - a mention log per conversation, at most 512 entries with the oldest dropped. Each entry holds `mentionId`, `deliveryId`, the mentioning agent or the owner, the mentioned agent, the depth, the state, and the times.
  - pending starts beside the launch records, mode 0600, at most 16, each with the new workspace ID, the starting agent, the title, the first turn, and the time. A pending start is dropped once its session opens or after an hour, so the first turn then lives only in the provider's transcript, as an owner's instruction does.

  Message text stays in the providers' transcripts. The mention log holds no text.

- **Events.** Each carries identifiers, counts, and times only, never message text. A session appears only as `providerSessionDigest`, the digest the hosted session events carry, so its UUID stays on the host. They need event schema 15; readers ship first, and the [payload contracts](../events-and-privacy/event-envelope-compatibility.md) define each:
  - `room.participant.joined`: `workspaceId`, `agentId`, `providerSessionDigest`, `mentionedBy` (an agent ID or `owner`), `occurredAt`.
  - `room.mention.recorded`: `workspaceId`, `mentionId` (`mnt_` and 24 hex digits), `fromAgentId` (or null for the owner), `toAgentId`, `depth` (0 to 8), `occurredAt`.
  - `room.mention.delivered`: `mentionId`, `providerSessionDigest`, `occurredAt`.
  - `room.mention.failed`: `mentionId`, `code`, `occurredAt`.
  - `room.exchange.paused`: `workspaceId`, `agentTurnCount` (0 to 1,000), `limit` (1 to 1,000), `openerAgentId` (or null when the core saw no owner turn open the exchange), `occurredAt`. The chain stopped and nothing was lost.
- **Who records them.** The resident's room router records the events off the decoder's path, in the conversation's registered repository, only while its writer selects schema 15 or later.
  - `room.mention.recorded`: when a turn's mention becomes a delivery.
  - `room.mention.delivered`: when the session host writes the delivered turn, preceded by `room.participant.joined` when the delivery brought its agent into the conversation.
  - `room.exchange.paused`: at the exchange budget.
  - Each event's ID derives from its content, so recording one twice keeps one. A store that cannot take them changes nothing in the room.
  - `room.mention.failed` has no writer yet: the session host shows a failed delivery in the conversation, but does not report it to the core.
- **Failures.** A mention that cannot be delivered shows as a room line and as attention, and is never retried silently.

| Code                         | Meaning                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| `mention_target_inactive`    | The mentioned agent is suspended or retired.                                           |
| `room_session_unavailable`   | The agent's session could not start, such as when no one is signed in to its provider. |
| `room_delivery_failed`       | The session host could not write the turn to the agent's session.                      |
| `exchange_paused`            | The exchange budget or depth bound stopped the chain.                                  |
| `agent_not_caller`           | `--started-by` names an agent other than the calling session's. Nothing was prepared.  |
| `conversation_start_limited` | The agent started 4 conversations in the last hour. Nothing was prepared.              |

- A mention grants no repository authority. Work a mention asks for runs under the mentioned agent's own assignment and lease.

## Channels (later)

Channels may later group conversations by topic, as Discord channels group threads. They organize conversations and are not rooms for agents (ADR-0644). Nothing in S2g waits for them.

## Open items

- Whether a read-access participant may run the conversation's tests. S2h's claims skip the build output Git ignores, so this depends only on the read-access tool allowlist ([Lervo ADE coordination](ade-coordination.md#read-access-participants)).
- How long a joined agent's session stays open after its last turn before the session host stops it.
