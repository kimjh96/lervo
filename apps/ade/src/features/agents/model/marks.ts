// Each team agent's image (Lervo ADE agents, "The profile"): chosen in the profile, stored by the
// core as a project asset, and shown wherever the agent's mark is, from the thumbnails the ADE
// keeps by the image's hash, as it does for project marks.
import type { ApplicationCommands, Choosers, Files, Images, ProjectMemory } from "../../../ports";
import { bytesOf, keepMark } from "../../projects";
import { showProjectAgents } from "./controller";
import { useAgentStore } from "./store";

export interface AgentMarkDependencies {
  readonly commands: ApplicationCommands;
  readonly images: Images;
  readonly memory: ProjectMemory;
  readonly files: Files;
  readonly choosers: Choosers;
}

const reading = new Set<string>();

/** Reads each listed agent image the ADE has not kept yet, one at a time. */
async function refreshAgentMarks(
  dependencies: AgentMarkDependencies,
  kept: (sha256: string) => boolean,
): Promise<void> {
  const { projectId, agents } = useAgentStore.getState();
  if (projectId === null) return;
  for (const agent of agents) {
    const mark = agent.mark;
    if (mark === null || mark === undefined || kept(mark.sha256) || reading.has(mark.sha256))
      continue;
    reading.add(mark.sha256);
    try {
      const { image } = await dependencies.commands.run("agent.mark.read", {
        projectId,
        agentId: agent.agentId,
      });
      if (image !== null)
        await keepMark(
          dependencies,
          image.sha256,
          new Blob([bytesOf(image.data)], { type: image.mediaType }),
        );
    } catch {
      // The first letter stays; the next list tries again.
    } finally {
      reading.delete(mark.sha256);
    }
  }
}

/** Keeps agents' images current: it reads the images of each new list of agents. */
export function bindAgentMarks(
  dependencies: AgentMarkDependencies,
  kept: (sha256: string) => boolean,
): () => void {
  void refreshAgentMarks(dependencies, kept);
  return useAgentStore.subscribe((store, previous) => {
    if (store.agents !== previous.agents) void refreshAgentMarks(dependencies, kept);
  });
}

/** Opens the image panel and sets the chosen image as the agent's; rejects on failure. */
export async function chooseAgentMark(
  dependencies: AgentMarkDependencies,
  projectId: string,
  agent: { agentId: string; revision: number },
  title: string,
): Promise<void> {
  const path = await dependencies.choosers.image(title);
  if (path === null) return;
  const data = await dependencies.images.prepareMark(await dependencies.files.readImage(path));
  const { agent: changed } = await dependencies.commands.run("agent.mark.set", {
    projectId,
    agentId: agent.agentId,
    revision: agent.revision,
    data,
  });
  // The thumbnail comes from the prepared bytes, so the image shows without reading it back.
  if (changed.mark !== null && changed.mark !== undefined)
    await keepMark(
      dependencies,
      changed.mark.sha256,
      new Blob([bytesOf(data)], { type: changed.mark.mediaType }),
    );
  await showProjectAgents(dependencies.commands, projectId);
}

/** Clears the agent's image, so its first letter shows again; rejects on failure. */
export async function clearAgentMark(
  commands: ApplicationCommands,
  projectId: string,
  agent: { agentId: string; revision: number },
): Promise<void> {
  await commands.run("agent.mark.clear", {
    projectId,
    agentId: agent.agentId,
    revision: agent.revision,
  });
  await showProjectAgents(commands, projectId);
}
