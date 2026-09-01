import {
  normalizeGovernedLoopPolicy,
  type GovernedLoopPolicyV1,
  type GovernedWorkReportV1,
} from "@lervo/application-contract";
import { listAssignments } from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";
import { collectProjectEventsBounded } from "@lervo/storage-contract";
import { projectGovernedWorkReport } from "@lervo/work-controller";

import { verifiedCurrentWorkstream } from "./workstream-services.js";

const maximumSourceEvents = 100_000;

export interface InspectGovernedWorkInput {
  repositoryRoot: string;
  policy?: Partial<GovernedLoopPolicyV1>;
  observedAt?: Date;
}

export type InspectGovernedWork = (
  input: InspectGovernedWorkInput,
) => Promise<GovernedWorkReportV1>;

export const inspectGovernedWork: InspectGovernedWork = async (input) => {
  const storage = await openProjectStorage(input.repositoryRoot);
  try {
    const workstream = await verifiedCurrentWorkstream(storage);
    if (workstream === null || workstream.status !== "active") {
      throw new Error("Governed work requires one verified active workstream.");
    }
    const [assignments, events] = await Promise.all([
      listAssignments(storage.paths.repositoryRoot),
      Promise.resolve(
        collectProjectEventsBounded({
          events: storage.events,
          maximumEvents: maximumSourceEvents,
        }),
      ),
    ]);
    return projectGovernedWorkReport({
      query: {
        schemaVersion: 1,
        kind: "governed_work.inspect",
        projectId: storage.manifest.projectId,
        workstreamId: workstream.workstreamId,
        observedAt: (input.observedAt ?? new Date()).toISOString(),
        policy: normalizeGovernedLoopPolicy(input.policy),
      },
      assignments,
      events,
    });
  } finally {
    await storage.close();
  }
};
