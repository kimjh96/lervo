// Each team agent's image (Lervo ADE agents, "The profile"): bounded as a project's mark and
// stored once by its hash, in a folder of its own, so a project changing its mark never removes
// an image an agent shows.
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

import {
  inspectMarkImage,
  MARK_EXTENSIONS,
  PROJECT_ASSETS_DIRECTORY,
  type ProjectMark,
  writeAtomically,
} from "./project-profile.js";

/** Where agents' images live, beside the project's mark. */
export const AGENT_MARKS_DIRECTORY = `${PROJECT_ASSETS_DIRECTORY}/agents`;

/** The repository-relative path of an agent's image. */
export function agentMarkAssetPath(mark: ProjectMark): string {
  return `${AGENT_MARKS_DIRECTORY}/${mark.sha256}.${MARK_EXTENSIONS[mark.mediaType]}`;
}

/** Checks `bytes` as a mark image and stores it once by its hash; returns its hash and format. */
export async function storeAgentMark(root: string, bytes: Uint8Array): Promise<ProjectMark> {
  const mark = inspectMarkImage(bytes);
  await writeAtomically(resolve(root, agentMarkAssetPath(mark)), bytes);
  return mark;
}

/** An agent image's bytes, or null when its file is missing. */
export async function readAgentMark(root: string, mark: ProjectMark): Promise<Buffer | null> {
  try {
    return await readFile(resolve(root, agentMarkAssetPath(mark)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Removes an image no agent shows any longer. */
export async function removeAgentMark(root: string, mark: ProjectMark): Promise<void> {
  await rm(resolve(root, agentMarkAssetPath(mark)), { force: true });
}
