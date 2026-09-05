import { listAgents } from "@lervo/agent-workforce";
import type { OperatingLivenessReportV1 } from "@lervo/application-contract";
import { openProjectStorage } from "@lervo/project-storage";

import { readOperatingLivenessEventSources } from "./operating-liveness-event-source.js";
import { createOperatingLivenessReport } from "./operating-liveness-projection.js";

export interface InspectOperatingLivenessInput {
  repositoryRoot: string;
  observedAt?: Date;
  staleAfterMs?: number;
}

export type InspectOperatingLiveness = (
  input: InspectOperatingLivenessInput,
) => Promise<OperatingLivenessReportV1>;

export const inspectOperatingLiveness: InspectOperatingLiveness = async (input) => {
  const [agents, storage] = await Promise.all([
    listAgents(input.repositoryRoot),
    openProjectStorage(input.repositoryRoot),
  ]);
  try {
    const sources = readOperatingLivenessEventSources(storage.events);
    return createOperatingLivenessReport({
      projectId: storage.manifest.projectId,
      agents,
      ...sources,
      observedAt: input.observedAt ?? new Date(),
      ...(input.staleAfterMs === undefined ? {} : { staleAfterMs: input.staleAfterMs }),
    });
  } finally {
    await storage.close();
  }
};
