import type {
  AssignmentCommunicationQueryV1,
  AssignmentCommunicationReportV1,
} from "@lervo/application-contract";
import { listAgents, listAssignments } from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";
import { projectAssignmentCommunications } from "@lervo/work-controller";

import { verifiedCurrentWorkstream } from "./workstream-services.js";

export interface InspectAssignmentCommunicationsInput {
  repositoryRoot: string;
  assignmentId?: string;
  recipientAgentId?: string;
  observedAt?: Date;
}

export type InspectAssignmentCommunications = (
  input: InspectAssignmentCommunicationsInput,
) => Promise<AssignmentCommunicationReportV1>;

export const inspectAssignmentCommunications: InspectAssignmentCommunications = async (input) => {
  const storage = await openProjectStorage(input.repositoryRoot);
  try {
    const workstream = await verifiedCurrentWorkstream(storage);
    if (workstream === null) {
      throw new Error("Assignment communication inspection requires a verified workstream.");
    }
    const [assignments, agents] = await Promise.all([
      listAssignments(storage.paths.repositoryRoot),
      listAgents(storage.paths.repositoryRoot),
    ]);
    const query: AssignmentCommunicationQueryV1 = {
      schemaVersion: 1,
      kind: "assignment_communication.inspect",
      projectId: storage.manifest.projectId,
      workstreamId: workstream.workstreamId,
      observedAt: (input.observedAt ?? new Date()).toISOString(),
      assignmentId: input.assignmentId ?? null,
      recipientAgentId: input.recipientAgentId ?? null,
    };
    return projectAssignmentCommunications({ query, assignments, agents });
  } finally {
    await storage.close();
  }
};
