// What the resident core loads about a session's conversation (Lervo ADE rooms, "Routing").
import {
  defaultRepositoryRegistryPath,
  resolveRegisteredRepository,
} from "@lervo/repository-registry";

import {
  conversationsLedBy,
  hostedLaunchRecordsPath,
  latestHostedLaunch,
  latestHostedLaunchOfSession,
  roomSessionRecords,
} from "./hosted-launch-records.js";
import { learnedEntries } from "./core-link-agent-context.js";
import { clipAtWord } from "./conversation-note-text.js";
import type { RoomContext } from "./room-router.js";
import { teamAgents, type TeamAgent } from "./workspace-participants.js";
import { worktreesByBranch } from "./workspace-start-effects.js";

/** A session's conversation, and whether the session joined it with read access only. */
export interface SessionRoom extends RoomContext {
  /** The session reads and answers, never writes: it joined by a mention (Lervo ADE rooms). */
  readonly readOnly?: boolean;
}

/**
 * The conversation of a session that carries an agent: the project's team and each agent's session
 * there. A session without an agent, or of a project no longer registered, has none.
 */
export async function loadRoomContext(sessionId: string): Promise<SessionRoom | null> {
  const path = hostedLaunchRecordsPath();
  const record = await latestHostedLaunchOfSession(path, sessionId);
  if (record?.agentId === undefined) return null;
  const repository = await resolveRegisteredRepository({
    registryPath: defaultRepositoryRegistryPath(),
    projectId: record.projectId,
  }).catch(() => null);
  if (repository === null) return null;
  const sessions = new Map<string, string>();
  for (const room of await roomSessionRecords(path, record.workspaceId))
    if (room.agentId !== undefined) sessions.set(room.agentId, room.sessionId);
  return {
    workspaceId: record.workspaceId,
    projectId: record.projectId,
    repositoryRoot: repository.repositoryRoot,
    provider: record.provider,
    agentId: record.agentId,
    team: await teamAgents(repository.repositoryRoot),
    sessions,
    ...(record.access === "read" ? { readOnly: true } : {}),
  };
}

function named(agents: readonly { displayName: string; roleName: string }[]): string {
  return agents.map((agent) => `${agent.displayName} (${agent.roleName})`).join(", ");
}

/** The team with each agent's ID, which a conversation handed to a teammate names (ADR-0657). */
function namedWithIds(
  agents: readonly { agentId: string; displayName: string; roleName: string }[],
): string {
  return agents
    .map((agent) => `${agent.displayName} (${agent.roleName}, ${agent.agentId})`)
    .join(", ");
}

/** The most teammates' conversations a block names, so the block stays bounded. */
const LISTED_CONVERSATIONS = 12;

/**
 * The open conversations the session's teammates lead, newest first, as `send` names them
 * (ADR-0657): the lead, the workspace ID, and the branch. A conversation whose worktree is gone,
 * such as a retired one, is not listed.
 */
async function teammateConversations(
  context: RoomContextLike,
  teammates: readonly TeamAgent[],
): Promise<string[]> {
  if (context.repositoryRoot === undefined || teammates.length === 0) return [];
  const path = hostedLaunchRecordsPath();
  const live = await worktreesByBranch(context.repositoryRoot);
  const lines: string[] = [];
  for (const teammate of teammates)
    for (const workspaceId of await conversationsLedBy(path, teammate.agentId)) {
      if (workspaceId === context.workspaceId) continue;
      const record = await latestHostedLaunch(path, workspaceId);
      if (record?.projectId !== context.projectId || !live.has(record.branch)) continue;
      lines.push(`- ${teammate.displayName}: ${workspaceId} (${record.branch})`);
      if (lines.length >= LISTED_CONVERSATIONS) return lines;
    }
  return lines;
}

type RoomContextLike = Pick<SessionRoom, "workspaceId" | "projectId" | "repositoryRoot">;

/** The most of an agent's own notes its session's start recalls. */
const RECALLED_NOTES = 3;
/** The most UTF-8 bytes the recalled notes take in the block, so the block stays bounded. */
export const RECALLED_NOTE_BYTES = 2_048;
/** How long the block waits for the notes; past it, the session starts without them. */
const RECALL_DEADLINE_MS = 1_000;

/**
 * The agent's own newest conversation notes, as its block recalls them (ADR-0648): its own
 * words, never another agent's, and labeled as what it noted itself. None when they cannot be
 * read in time, so the rest of the block always reaches the session.
 */
async function ownNotes(repositoryRoot: string | undefined, agentId: string): Promise<string[]> {
  if (repositoryRoot === undefined) return [];
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<string[]>((resolve) => {
    timer = setTimeout(() => resolve([]), RECALL_DEADLINE_MS);
  });
  try {
    return await Promise.race([
      learnedEntries(repositoryRoot, agentId).then(recalledNotes, () => []),
      late,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The lines of the newest conversation notes among an agent's entries, newest first: each cut at
 * a word within a note's limit, and no more than `RECALLED_NOTE_BYTES` together.
 */
export function recalledNotes(
  entries: readonly { readonly kind: string; readonly summary: string | null }[],
): string[] {
  const lines: string[] = [];
  let bytes = 0;
  for (const entry of entries) {
    if (entry.kind !== "conversation_note" || entry.summary === null) continue;
    const line = `- ${clipAtWord(entry.summary)}`;
    bytes += Buffer.byteLength(line) + 1;
    if (bytes > RECALLED_NOTE_BYTES || lines.push(line) === RECALLED_NOTES) break;
  }
  return lines;
}

/**
 * What a hosted session with an agent learns at its start (Lervo ADE rooms, "What each session
 * knows"): who it is, who else is in the conversation and on the team, how a mention works, and
 * its own newest notes from earlier conversations. Null for a session without an agent or a
 * conversation.
 */
export async function roomBlock(sessionId: string): Promise<string | null> {
  const context = await loadRoomContext(sessionId);
  const self = context?.team.find((agent) => agent.agentId === context.agentId);
  if (context === null || self === undefined) return null;
  const others = context.team.filter((agent) => agent.agentId !== self.agentId);
  const present = others.filter((agent) => context.sessions.has(agent.agentId));
  const notes = await ownNotes(context.repositoryRoot, self.agentId);
  const led = await teammateConversations(context, others).catch(() => []);
  return [
    `Lervo room: you are ${self.displayName}, the ${self.roleName}, in this conversation${
      present.length === 0 ? "" : ` with ${named(present)}`
    }.`,
    others.length === 0 ? null : `The project's team: ${namedWithIds(others)}.`,
    "When your work needs another agent's role or what it knows, write @Name in your reply. Your message reaches that agent, and its answer comes back to you as a turn. Mention the product owner only for priorities and decisions; never route work through it. A mention grants no access beyond your own: an agent you mention joins this conversation able to read and answer, never to change files.",
    context.readOnly === true
      ? "Your session in this conversation reads and answers; it cannot change files. When a request needs changes, start a conversation you lead for them, as below, and say so in your answer. Never ask anyone for write permission here."
      : null,
    `When work belongs apart from this conversation, start a conversation for it: run \`lervo workspace start --repository ${context.projectId} --started-by ${self.agentId} --title "<title>" --json <<'EOF'\`, then its first turn, then \`EOF\`. It opens when your turn ends. You lead it unless you add \`--lead <agent ID>\` to hand it to the teammate whose work it is: that teammate leads it and changes the files, your request is its first turn, and it mentions you when it needs you. Hand each owner its own work this way rather than doing it yourself. Never start one for work this conversation already covers.`,
    led.length === 0
      ? null
      : [
          `Work for a conversation a teammate already leads goes there, not to a new one: run \`lervo workspace send --workspace <workspace ID> --from ${self.agentId} --json <<'EOF'\`, then the request, then \`EOF\`. It reaches the lead as your message when your turn ends. Open conversations your teammates lead:`,
          ...led,
        ].join("\n"),
    "Hand work over and ask only through these Lervo commands and mentions. Never message another session through a provider's own tools, and never stop a process Lervo runs; when a conversation is no longer needed, say so in your answer and the owner removes it.",
    notes.length === 0
      ? null
      : [
          "Your own notes from earlier conversations, which you wrote yourself and no one reviewed:",
          ...notes,
        ].join("\n"),
  ]
    .filter((line) => line !== null)
    .join("\n");
}
