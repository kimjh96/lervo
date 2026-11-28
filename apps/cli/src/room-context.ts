// What the resident core loads about a session's conversation (Lervo ADE rooms, "Routing").
import {
  defaultRepositoryRegistryPath,
  resolveRegisteredRepository,
} from "@lervo/repository-registry";

import {
  conversationOf,
  conversationsLedBy,
  hostedLaunchRecordsPath,
  latestHostedLaunch,
  latestHostedLaunchOfSession,
  roomSessionRecords,
} from "./hosted-launch-records.js";
import { learnedEntries } from "./core-link-agent-context.js";
import { clipAtWord } from "./conversation-note-text.js";
import { hiringGuidanceFor } from "./room-hiring-guidance.js";
import type { RoomContext } from "./room-router.js";
import { teamAgents, type TeamAgent } from "./workspace-participants.js";
import { worktreesByBranch } from "./workspace-start-effects.js";

/** A session's conversation, and whether the session joined it with read access only. */
export interface SessionRoom extends RoomContext {
  /**
   * The session reads and answers, never writes: it joined by a mention before members worked in
   * their own workspaces (ADR-0661).
   */
  readonly readOnly?: boolean;
  /** Each agent's branch in the conversation: the lead's worktree's, or a member's own. */
  readonly branches: ReadonlyMap<string, string>;
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
  // A member's session takes part in the conversation its own workspace belongs to.
  const workspaceId = conversationOf(record);
  const sessions = new Map<string, string>();
  const branches = new Map<string, string>();
  for (const room of await roomSessionRecords(path, workspaceId))
    if (room.agentId !== undefined) {
      sessions.set(room.agentId, room.sessionId);
      branches.set(room.agentId, room.branch);
    }
  return {
    workspaceId,
    projectId: record.projectId,
    repositoryRoot: repository.repositoryRoot,
    provider: record.provider,
    agentId: record.agentId,
    team: await teamAgents(repository.repositoryRoot),
    sessions,
    branches,
    ...(record.access === "read" ? { readOnly: true } : {}),
  };
}

/**
 * Where each agent of the conversation works (ADR-0661): a line per agent with its worktree, the
 * session's own first. None when the worktrees cannot be listed.
 */
async function worktreeLines(context: SessionRoom, team: readonly TeamAgent[]): Promise<string[]> {
  if (context.repositoryRoot === undefined) return [];
  const live = await worktreesByBranch(context.repositoryRoot);
  const ordered = [...context.branches].sort(
    ([left], [right]) => Number(right === context.agentId) - Number(left === context.agentId),
  );
  return ordered.flatMap(([agentId, branch]) => {
    const path = live.get(branch);
    const agent = team.find((candidate) => candidate.agentId === agentId);
    if (path === undefined || agent === undefined) return [];
    return [`- ${agentId === context.agentId ? "You" : agent.displayName}: ${path}`];
  });
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
 * knows"): who it is, who else is in the conversation and on the team, how a mention works, how
 * to hire when its role may (ADR-0662), and its own newest notes from earlier conversations. Null for a session without an agent or a
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
  const worktrees = await worktreeLines(context, context.team).catch(() => []);
  const hiring = await hiringGuidanceFor(
    context.repositoryRoot,
    self.agentId,
    context.provider,
  ).catch(() => null);
  return [
    `Lervo room: you are ${self.displayName}, the ${self.roleName}, in this conversation${
      present.length === 0 ? "" : ` with ${named(present)}`
    }.`,
    others.length === 0 ? null : `The project's team: ${namedWithIds(others)}.`,
    "When your work needs another agent's role or what it knows, write @Name in your reply. Your message reaches that agent, and its answer comes back to you as a turn. An agent you mention joins this conversation and works in its own worktree, so hand each teammate its own work here by mention rather than doing it yourself. Ask the teammate you need directly; no role, the product owner's included, routes work.",
    "Answer whoever asked you, here. Keep working until the request is done or you are blocked, then say what you did, what comes next, and what you need from whom. The conversation's lead keeps the owner informed and raises what only the owner can decide; anyone speaks to the owner directly when only the owner can answer.",
    context.readOnly === true
      ? "Your session in this conversation reads and answers; it cannot change files. When a request needs changes, say so in your answer and name who should make them. Never ask anyone for write permission here."
      : "Commit your work in your own worktree, and seal a finished, committed change with `lervo workspace seal --write`. Read the other agents' worktrees when you need their work, but write only in yours.",
    worktrees.length === 0
      ? null
      : ["Where each agent of this conversation works:", ...worktrees].join("\n"),
    `Start a separate conversation only for a topic of its own, never for work inside this conversation's topic: run \`lervo workspace start --repository ${context.projectId} --started-by ${self.agentId} --title "<title>" --json <<'EOF'\`, then its first turn, then \`EOF\`. It opens when your turn ends. You lead it unless you add \`--lead <agent ID>\` to hand it to the teammate whose topic it is: that teammate leads it, your request is its first turn, and it mentions you when it needs you.`,
    led.length === 0
      ? null
      : [
          `Work for a conversation a teammate already leads goes there, not to a new one: run \`lervo workspace send --workspace <workspace ID> --from ${self.agentId} --json <<'EOF'\`, then the request, then \`EOF\`. It reaches the lead as your message when your turn ends. Open conversations your teammates lead:`,
          ...led,
        ].join("\n"),
    hiring,
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
