import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

import {
  readConvergenceOwnerHost,
  type ConvergenceOwnerHubCandidate,
} from "@lervo/repository-knowledge-runtime";

import { hostRepositoryRoots } from "./knowledge-host-repositories.js";
import { registeredNodeHubCoordinates } from "./knowledge-node-hub-coordinates.js";

/**
 * ADR-0469 Hub coordinates for a CLI-hosted resident, most specific first: the Node registered
 * for this exact checkout, then the Hub configurations of other repositories on this host. A
 * candidate is only a proposal; continuity probes it for this project before using it.
 */
export async function knowledgeHostHubCandidates(
  repositoryRoot: string,
): Promise<ConvergenceOwnerHubCandidate[]> {
  const candidates: ConvergenceOwnerHubCandidate[] = [];
  const node = await registeredNodeHubCoordinates(repositoryRoot);
  if (node !== null) candidates.push({ source: "node_runtime", hub: node });
  const self = await realpath(resolve(repositoryRoot)).catch(() => resolve(repositoryRoot));
  for (const root of await hostRepositoryRoots()) {
    if (root === self) continue;
    const host = await readConvergenceOwnerHost(root).catch(() => null);
    if (host?.config.coordination.mode !== "hub") continue;
    const hub = host.config.coordination.hub;
    if (!candidates.some((candidate) => JSON.stringify(candidate.hub) === JSON.stringify(hub)))
      candidates.push({ source: "host_repository", hub: { ...hub } });
    if (candidates.length >= 4) break;
  }
  return candidates;
}
