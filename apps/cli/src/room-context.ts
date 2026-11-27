// What the resident core loads about a session's conversation (Lervo ADE rooms, "Routing").
import {
  defaultRepositoryRegistryPath,
  resolveRegisteredRepository,
} from "@lervo/repository-registry";

import {
  hostedLaunchRecordsPath,
  latestHostedLaunchOfSession,
  roomSessionRecords,
} from "./hosted-launch-records.js";
import { learnedEntries } from "./core-link-agent-context.js";
import { clipAtWord } from "./conversation-note-text.js";
import type { RoomContext } from "./room-router.js";
import { teamAgents } from "./workspace-participants.js";

/**
 * The conversation of a session that carries an agent: the project's team and each agent's session
 * there. A session without an agent, or of a project no longer registered, has none.
 */
export async function loadRoomContext(sessionId: string): Promise<RoomContext | null> {
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
  };
}

function named(agents: readonly { displayName: string; roleName: string }[]): string {
  return agents.map((agent) => `${agent.displayName} (${agent.roleName})`).join(", ");
}

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
  return [
    `Lervo room: you are ${self.displayName}, the ${self.roleName}, in this conversation${
      present.length === 0 ? "" : ` with ${named(present)}`
    }.`,
    others.length === 0 ? null : `The project's team: ${named(others)}.`,
    "When your work needs another agent's role or what it knows, write @Name in your reply. Your message reaches that agent, and its answer comes back to you as a turn. Mention the product owner only for priorities and decisions; never route work through it. A mention grants no access beyond your own.",
    `When work is your own and belongs apart from this conversation, start a conversation you lead: run \`lervo workspace start --repository ${context.projectId} --started-by ${self.agentId} --title "<title>" --json\` with its first turn on standard input. It opens when your turn ends. Never start one for work this conversation already covers.`,
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
