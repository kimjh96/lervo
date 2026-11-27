// What an agent has learned and the paths it holds, as its profile shows them (Lervo ADE agents,
// "The profile").
import { projectAgentContextFromEventSource } from "@lervo/agent-organization";
import { listAgents, listAssignments, readConversationChangedPaths } from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";
import {
  type AgentContextResult,
  MAXIMUM_HELD_PATHS,
  MAXIMUM_LEARNED_ENTRIES,
  MAXIMUM_LEARNED_SUMMARY_CHARACTERS,
} from "@lervo/session-host-contract";

import { CommandFailure } from "./command-error-output.js";
import { conversationsLedBy, hostedLaunchRecordsPath } from "./hosted-launch-records.js";

type LearnedEntry = AgentContextResult["entries"][number];

/**
 * The agent's promoted context entries that are still active and unexpired, newest first, with
 * each summary read from the project's artifact store. A restricted entry keeps its summary to
 * the agent's own sessions, and a summary that cannot be read shows as none rather than failing
 * the profile.
 */
export async function learnedEntries(
  repositoryRoot: string,
  agentId: string,
  now = new Date(),
): Promise<LearnedEntry[]> {
  // A profile reads; it never creates the repository's workforce home.
  const agents = await listAgents(repositoryRoot, { readOnly: true });
  if (!agents.some((agent) => agent.agentId === agentId))
    throw new CommandFailure("agent_not_found", "No agent of this project has that ID.");
  const storage = await openProjectStorage(repositoryRoot);
  try {
    const projection = projectAgentContextFromEventSource({
      projectId: storage.manifest.projectId,
      agentId,
      agents,
      events: storage.events,
    });
    const observed = (entry: (typeof projection.entries)[number]) =>
      entry.observedAt ?? entry.promotedAt;
    const active = projection.entries
      .filter(
        (entry) =>
          entry.status === "active" &&
          (entry.expiresAt === undefined ||
            entry.expiresAt === null ||
            Date.parse(entry.expiresAt) > now.getTime()),
      )
      .sort((left, right) => observed(right).localeCompare(observed(left)))
      .slice(0, MAXIMUM_LEARNED_ENTRIES);
    return await Promise.all(
      active.map(async (entry): Promise<LearnedEntry> => {
        const summary =
          entry.sensitivity === "restricted"
            ? null
            : await storage.artifacts
                .get(`lervo-cas://sha256/${entry.summaryContentHash.slice("sha256:".length)}`)
                .then((bytes) =>
                  new TextDecoder().decode(bytes).slice(0, MAXIMUM_LEARNED_SUMMARY_CHARACTERS),
                )
                .catch(() => null);
        return {
          entryId: entry.contextEntryId,
          layer: entry.layer,
          kind: entry.memoryKind ?? entry.layer,
          subject: entry.subjectKey ?? "",
          observedAt: observed(entry),
          summary,
        };
      }),
    );
  } finally {
    await storage.close();
  }
}

/**
 * The repository paths the agent holds under a live write lease, sorted: the first
 * `MAXIMUM_HELD_PATHS` and how many there are. A lease that expired holds nothing, and a read
 * lease never blocks a write, so neither counts.
 */
export async function heldPaths(
  repositoryRoot: string,
  agentId: string,
  now = new Date(),
): Promise<{ paths: string[]; total: number }> {
  const held = new Set<string>();
  for (const assignment of await listAssignments(repositoryRoot, { readOnly: true })) {
    const lease = assignment.lease;
    if (assignment.status !== "leased" || lease === null || lease.agentId !== agentId) continue;
    if (assignment.accessMode === "read_only" || Date.parse(lease.expiresAt) <= now.getTime())
      continue;
    for (const path of assignment.expectedPaths) held.add(path);
  }
  const sorted = [...held].sort();
  return { paths: sorted.slice(0, MAXIMUM_HELD_PATHS), total: sorted.length };
}

/** The most conversations whose changed paths one profile reads. */
const MAXIMUM_READ_CONVERSATIONS = 32;

/**
 * The paths the conversations `agentId` leads changed and have not sealed yet (Lervo ADE
 * coordination, "Reconciliation"): the first `MAXIMUM_HELD_PATHS`, sorted, and how many there are.
 * It reads each conversation's newest open generation and writes nothing.
 */
export async function changedPaths(
  repositoryRoot: string,
  agentId: string,
  launches = hostedLaunchRecordsPath(),
  read: typeof readConversationChangedPaths = readConversationChangedPaths,
): Promise<{ paths: string[]; total: number }> {
  const conversations = (await conversationsLedBy(launches, agentId)).slice(
    0,
    MAXIMUM_READ_CONVERSATIONS,
  );
  const changed = new Set<string>();
  let beyond = 0;
  for (const conversationId of conversations) {
    const summary = await read(repositoryRoot, conversationId);
    if (summary === null) continue;
    for (const path of summary.paths) changed.add(path);
    beyond += Math.max(0, summary.total - summary.paths.length);
  }
  const sorted = [...changed].sort();
  return { paths: sorted.slice(0, MAXIMUM_HELD_PATHS), total: sorted.length + beyond };
}
