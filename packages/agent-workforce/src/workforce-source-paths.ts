import { resolve } from "node:path";

import { capabilityRoot } from "@lervo/capabilities";
import { resolveProjectPaths } from "@lervo/project";

import { state } from "./workforce-state-io.js";

/**
 * Every file or tree that agent and assignment listings read, so a caller can tell whether a new
 * listing could differ without reading them. Built-in roles are compiled in and need no path.
 */
export async function workforceSourcePaths(
  repositoryRoot: string,
): Promise<{ files: string[]; trees: string[] }> {
  const { base } = await state(repositoryRoot, { readOnly: true });
  return {
    files: [resolveProjectPaths(repositoryRoot).projectManifest, resolve(base, "agents.json")],
    trees: [
      resolve(base, "assignments"),
      resolve(repositoryRoot, ".lervo/roles"),
      capabilityRoot(repositoryRoot, "project"),
      capabilityRoot(repositoryRoot, "user"),
    ],
  };
}
