import { dirname } from "node:path";

import { readModelSelection, type ModelSelectionRead } from "@lervo/execution-contract";
import { defaultRepositoryRegistryPath } from "@lervo/repository-registry";

/**
 * ADR-0612: the host directory of the model selection, beside the repository registry and the
 * host continuity policy, outside every repository. Every process of this user reads the same
 * file, so a change reaches a running resident at its next provider call.
 */
export function hostModelSelectionDirectory(environment: NodeJS.ProcessEnv = process.env): string {
  return dirname(defaultRepositoryRegistryPath(environment));
}

export function readHostModelSelection(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ModelSelectionRead> {
  return readModelSelection(hostModelSelectionDirectory(environment));
}
