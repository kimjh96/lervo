import { openProjectStorage } from "@lervo/project-storage";
import type { OperatingObjectiveReportV1 } from "@lervo/application-contract";

import { verifiedCurrentWorkstream } from "./workstream-services.js";

export interface InspectOperatingObjectiveInput {
  repositoryRoot: string;
  observedAt?: Date;
}

export type InspectOperatingObjective = (
  input: InspectOperatingObjectiveInput,
) => Promise<OperatingObjectiveReportV1>;

export const inspectOperatingObjective: InspectOperatingObjective = async (input) => {
  const storage = await openProjectStorage(input.repositoryRoot);
  try {
    const workstream = await verifiedCurrentWorkstream(storage);
    if (workstream === null) throw new Error("Operating objective requires a verified workstream.");
    return {
      schemaVersion: 1,
      projectId: storage.manifest.projectId,
      workstreamId: workstream.workstreamId,
      workstreamRevision: workstream.revision,
      status: workstream.status,
      title: workstream.title,
      objective: workstream.objective,
      nextActions: [...workstream.nextActions],
      blockers: [...workstream.blockers],
      pendingDecisions: (workstream.pendingDecisions ?? []).map((decision) => ({
        decisionId: decision.decisionId,
        question: decision.question,
        blocking: decision.blocking,
        choices: decision.choices.map((choice) => ({ ...choice })),
        recommendedChoiceId: decision.recommendedChoiceId,
      })),
      pendingApprovals: (workstream.pendingApprovals ?? []).map((approval) => ({ ...approval })),
      updatedAt: workstream.updatedAt,
      observedAt: (input.observedAt ?? new Date()).toISOString(),
    };
  } finally {
    await storage.close();
  }
};
