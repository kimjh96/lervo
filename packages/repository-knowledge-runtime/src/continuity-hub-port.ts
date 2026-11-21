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

/** The Hub port for this checkout's host records, or the failure that kept it from opening. */
export async function continuityHostPort(
  host: ConvergenceOwnerHost | null,
  transport: ConvergenceHostRecordTransport | undefined,
  storage: ProjectStorage,
): Promise<{ port: ConvergenceHostRecordPort | null; failureCode: string | null }> {
  if (host?.config.coordination.mode !== "hub" || transport === undefined)
    return { port: null, failureCode: null };
  try {
    return {
      port: await transport({
        ...host.config.coordination.hub,
        projectId: storage.manifest.projectId,
        repositoryIdentityHash: calculateProjectIdentityHash(storage.manifest),
      }),
      failureCode: null,
    };
  } catch (error) {
    return { port: null, failureCode: knowledgeConvergenceOwnerFailureOf(error).failureCode };
  }
}
