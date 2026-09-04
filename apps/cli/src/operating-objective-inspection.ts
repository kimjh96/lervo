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

export function projectOperatingObjective(input: {
  projectId: string;
  workstream: NonNullable<Awaited<ReturnType<typeof verifiedCurrentWorkstream>>>;
  observedAt: Date;
}): OperatingObjectiveReportV1 {
  return {
    schemaVersion: 1,
    projectId: input.projectId,
    workstreamId: input.workstream.workstreamId,
    workstreamRevision: input.workstream.revision,
    status: input.workstream.status,
    title: input.workstream.title,
    objective: input.workstream.objective,
    nextActions: [...input.workstream.nextActions],
    blockers: [...input.workstream.blockers],
    pendingDecisions: (input.workstream.pendingDecisions ?? []).map((decision) => ({
      decisionId: decision.decisionId,
      question: decision.question,
      blocking: decision.blocking,
      choices: decision.choices.map((choice) => ({ ...choice })),
      recommendedChoiceId: decision.recommendedChoiceId,
    })),
    pendingApprovals: (input.workstream.pendingApprovals ?? []).map((approval) => ({
      ...approval,
    })),
    updatedAt: input.workstream.updatedAt,
    observedAt: input.observedAt.toISOString(),
  };
}

export const inspectOperatingObjective: InspectOperatingObjective = async (input) => {
  const storage = await openProjectStorage(input.repositoryRoot);
  try {
    const workstream = await verifiedCurrentWorkstream(storage);
    if (workstream === null) throw new Error("Operating objective requires a verified workstream.");
    return projectOperatingObjective({
      projectId: storage.manifest.projectId,
      workstream,
      observedAt: input.observedAt ?? new Date(),
    });
  } finally {
    await storage.close();
  }
};
