// What an agent has learned, as its profile shows it (Lervo ADE agents, "The profile").
import { projectAgentContextFromEventSource } from "@lervo/agent-organization";
import { listAgents } from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";
import {
  type AgentContextResult,
  MAXIMUM_LEARNED_ENTRIES,
  MAXIMUM_LEARNED_SUMMARY_CHARACTERS,
} from "@lervo/session-host-contract";

import { CommandFailure } from "./command-error-output.js";

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
  const agents = await listAgents(repositoryRoot);
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
