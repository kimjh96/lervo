import type { OperatingGoalReportV1 } from "@lervo/application-contract";
import { listAssignments } from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";
import { collectProjectEventsBounded } from "@lervo/storage-contract";
import {
  projectManagedAttempts,
  projectOperatingGoalReport,
  projectWorkGraph,
} from "@lervo/work-controller";

import { projectOperatingObjective } from "./operating-objective-inspection.js";
import { verifiedCurrentWorkstream } from "./workstream-services.js";

const MAXIMUM_SOURCE_EVENTS = 100_000;

export interface InspectOperatingGoalInput {
  repositoryRoot: string;
  observedAt?: Date;
}

export type InspectOperatingGoal = (
  input: InspectOperatingGoalInput,
) => Promise<OperatingGoalReportV1>;

export const inspectOperatingGoal: InspectOperatingGoal = async (input) => {
  const storage = await openProjectStorage(input.repositoryRoot);
  try {
    const workstream = await verifiedCurrentWorkstream(storage);
    if (workstream === null) throw new Error("Operating goal requires a verified workstream.");
    const observedAt = input.observedAt ?? new Date();
    const [assignments, events] = await Promise.all([
      listAssignments(storage.paths.repositoryRoot),
      Promise.resolve(
        collectProjectEventsBounded({
          events: storage.events,
          maximumEvents: MAXIMUM_SOURCE_EVENTS,
        }),
      ),
    ]);
    const attempts = projectManagedAttempts({
      events,
      workstreamId: workstream.workstreamId,
    }).attempts;
    const graph = projectWorkGraph({
      projectId: storage.manifest.projectId,
      workstreamId: workstream.workstreamId,
      assignments,
      attempts,
      observedAt: observedAt.toISOString(),
    });
    return projectOperatingGoalReport({
      objective: projectOperatingObjective({
        projectId: storage.manifest.projectId,
        workstream,
        observedAt,
      }),
      graph,
    });
  } finally {
    await storage.close();
  }
};
