// A team agent's image through the core link (Lervo ADE agents, "The profile"): stored as a
// project asset by its hash, bounded as a project's mark, and named in the agent's record.
import { changeAgentMark, listAgents, type WorkforceAgent } from "@lervo/agent-workforce";
import {
  ProjectProfileError,
  readAgentMark,
  removeAgentMark,
  storeAgentMark,
} from "@lervo/project";

import { CommandFailure } from "./command-error-output.js";
import { mutateWorkforceState } from "./workforce-mutation.js";

/** Base64 characters of an image: 512 KiB of bytes, as a project's mark. */
export const MAXIMUM_AGENT_MARK_CHARACTERS = 700_000;

async function agentOf(root: string, agentId: string): Promise<WorkforceAgent | undefined> {
  return (await listAgents(root, { readOnly: true })).find((agent) => agent.agentId === agentId);
}

/** Removes an image the change left without an agent showing it. */
async function dropUnused(root: string, previous: WorkforceAgent["mark"]): Promise<void> {
  if (previous === undefined) return;
  const agents = await listAgents(root, { readOnly: true });
  if (!agents.some((agent) => agent.mark?.sha256 === previous.sha256))
    await removeAgentMark(root, previous).catch(() => undefined);
}

/** Stores `data` as the agent's image and names it in the agent's record. */
export async function setAgentMark(
  root: string,
  agentId: string,
  expectedRevision: number,
  data: string,
): Promise<WorkforceAgent> {
  let mark;
  try {
    mark = await storeAgentMark(root, Buffer.from(data, "base64"));
  } catch (error) {
    if (error instanceof ProjectProfileError)
      throw new CommandFailure("agent_mark_invalid", error.message);
    throw error;
  }
  const previous = (await agentOf(root, agentId))?.mark;
  const agent = await mutateWorkforceState(root, (recordEvent) =>
    changeAgentMark({ repositoryRoot: root, agentId, expectedRevision, mark, recordEvent }),
  );
  await dropUnused(root, previous);
  return agent;
}

/** Clears the agent's image, so its first letter shows again. */
export async function clearAgentMark(
  root: string,
  agentId: string,
  expectedRevision: number,
): Promise<WorkforceAgent> {
  const previous = (await agentOf(root, agentId))?.mark;
  const agent = await mutateWorkforceState(root, (recordEvent) =>
    changeAgentMark({ repositoryRoot: root, agentId, expectedRevision, mark: null, recordEvent }),
  );
  await dropUnused(root, previous);
  return agent;
}

/** The agent's image with its bytes, or null when it has none or its file is missing. */
export async function readAgentMarkImage(root: string, agentId: string) {
  const mark = (await agentOf(root, agentId))?.mark;
  if (mark === undefined) return null;
  const bytes = await readAgentMark(root, mark);
  return bytes === null
    ? null
    : { sha256: mark.sha256, mediaType: mark.mediaType, data: bytes.toString("base64") };
}
