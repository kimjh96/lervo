import { dirname } from "node:path";

import {
  adoptModelSelection,
  isNewerModelSelection,
  parseModelSelection,
  readModelSelection,
  transportedModelSelection,
  type ModelSelection,
  type ModelSelectionRead,
} from "@lervo/execution-contract";
import type { KnowledgeConvergenceHostRecord } from "@lervo/sync-contract";
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

/**
 * ADR-0612 M3: adopts the newest model selection the peer hosts of a repository publish, when it
 * is newer than this host's. Each host publishes the same host-wide selection for every repository
 * it serves, so any shared repository carries a change to the other host.
 */
export async function adoptPeerModelSelection(
  records: readonly Pick<KnowledgeConvergenceHostRecord, "hostHash" | "modelSelection">[],
  ownHostHash: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ModelSelection | null> {
  let newest: ModelSelection | null = null;
  for (const peer of records) {
    // This host's own published copy is never adopted back, so deleting the file resets it.
    if (peer.hostHash === ownHostHash || peer.modelSelection === undefined) continue;
    let candidate: ModelSelection;
    try {
      candidate = parseModelSelection(peer.modelSelection);
    } catch {
      continue;
    }
    if (newest === null || isNewerModelSelection(candidate, newest)) newest = candidate;
  }
  if (newest === null) return null;
  const adopted = await adoptModelSelection({
    stateDirectory: hostModelSelectionDirectory(environment),
    candidate: transportedModelSelection(newest),
  });
  return adopted.status === "adopted" ? adopted.selection : null;
}
