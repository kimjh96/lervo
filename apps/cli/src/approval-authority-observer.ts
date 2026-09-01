import type {
  ApprovalAuthorityPort,
  ApprovalAuthorityQueryV1,
  ApprovalObservationV1,
  WorkGraphV1,
} from "@lervo/application-contract";

export async function observeGraphApprovals(input: {
  authority: ApprovalAuthorityPort;
  graph: WorkGraphV1;
}): Promise<ApprovalObservationV1[]> {
  const query: ApprovalAuthorityQueryV1 = {
    schemaVersion: 1,
    projectId: input.graph.projectId,
    workstreamId: input.graph.workstreamId,
    observedAt: input.graph.observedAt,
    requirements: input.graph.nodes.flatMap((node) =>
      node.approvalRequirementDigests.map((requirementDigest) => ({
        assignmentId: node.assignmentId,
        assignmentRevision: node.assignmentRevision,
        requirementDigest,
      })),
    ),
  };
  if (query.requirements.length === 0) return [];
  try {
    return await input.authority.observe(query);
  } catch {
    return query.requirements.map((requirement) => ({
      schemaVersion: 1,
      assignmentId: requirement.assignmentId,
      assignmentRevision: requirement.assignmentRevision,
      requirementDigest: requirement.requirementDigest,
      status: "invalid",
      reasonCode: "authority_unavailable",
    }));
  }
}
