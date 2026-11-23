import type { ProjectStorage } from "@lervo/project-storage";
import {
  calculateProjectIdentityHash,
  knowledgeConvergenceOwnerFailureOf,
} from "@lervo/sync-contract";

import type {
  ConvergenceHostRecordPort,
  ConvergenceHostRecordTransport,
} from "./convergence-continuity.js";
import type { ConvergenceOwnerHost } from "./convergence-owner-host.js";
import { adoptPeerModelSelection } from "./model-selection-host.js";

/**
 * ADR-0612 M3: every listing of this repository's host records also adopts a newer model
 * selection another host published, so the hosts converge on one selection. Adoption never fails
 * the listing; this host's own record is never newer than its own file.
 */
function withModelSelectionAdoption(port: ConvergenceHostRecordPort): ConvergenceHostRecordPort {
  return {
    ...port,
    list: async (signal) => {
      const listed = await port.list(signal);
      await adoptPeerModelSelection(listed).catch(() => undefined);
      return listed;
    },
  };
}

/** The Hub port for this checkout's host records, or the failure that kept it from opening. */
export async function continuityHostPort(
  host: ConvergenceOwnerHost | null,
  transport: ConvergenceHostRecordTransport | undefined,
  storage: ProjectStorage,
): Promise<{ port: ConvergenceHostRecordPort | null; failureCode: string | null }> {
  if (host?.config.coordination.mode !== "hub" || transport === undefined)
    return { port: null, failureCode: null };
  try {
    const port = await transport({
      ...host.config.coordination.hub,
      projectId: storage.manifest.projectId,
      repositoryIdentityHash: calculateProjectIdentityHash(storage.manifest),
    });
    return { port: withModelSelectionAdoption(port), failureCode: null };
  } catch (error) {
    return { port: null, failureCode: knowledgeConvergenceOwnerFailureOf(error).failureCode };
  }
}
