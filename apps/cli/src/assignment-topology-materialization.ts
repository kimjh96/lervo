import type {
  AssignmentTopologyApplyReceiptV2,
  AssignmentTopologyChangeRequestV2,
  AssignmentTopologyPlanV2,
  AssignmentTopologyRoleContractV2,
} from "@lervo/application-contract";
import {
  activateTopologyAssignment,
  createTopologyAssignment,
  listAssignments,
  withAssignmentTopologyLock,
  topologyAssignmentObservation,
} from "@lervo/agent-workforce";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import { resolveRoleContract } from "@lervo/roles";
import { assignmentTopologyDigest, createAssignmentTopologyPlan } from "@lervo/work-controller";

import { loadAssignmentTopologySnapshot } from "./assignment-topology-inspection.js";
import { recordWorkforceEvent } from "./workforce-events.js";

function reviewerDigest(reviewerId: string): string {
  if (!/^[a-z][a-z0-9]*(?:[._@/-][a-z0-9]+)*$/u.test(reviewerId) || reviewerId.length > 128)
    throw new Error("The topology reviewer identity is invalid.");
  return assignmentTopologyDigest({ kind: "assignment_topology_reviewer", reviewerId });
}

async function currentPlan(
  storage: ProjectStorage,
  request: AssignmentTopologyChangeRequestV2,
): Promise<AssignmentTopologyPlanV2> {
  const snapshot = await loadAssignmentTopologySnapshot(storage);
  const roleContracts: AssignmentTopologyRoleContractV2[] = [];
  for (const roleId of [...new Set(request.nodes.map((node) => node.roleId))].sort()) {
    const contract = await resolveRoleContract(storage.paths.repositoryRoot, roleId);
    roleContracts.push({
      roleId,
      roleVersion: contract.version,
      roleContractHash: contract.contractHash,
    });
  }
  return createAssignmentTopologyPlan({
    projectId: storage.manifest.projectId,
    currentWorkstreamId: snapshot.graph.workstreamId,
    currentGraphHash: snapshot.graph.graphHash,
    graphValid: snapshot.graph.validity.status === "valid",
    request,
    roleContracts,
    assignments: snapshot.assignments.map(topologyAssignmentObservation),
  });
}

export interface MaterializeAssignmentTopologyResult {
  plan: AssignmentTopologyPlanV2;
  receipt: AssignmentTopologyApplyReceiptV2 | null;
}

export async function materializeAssignmentTopology(input: {
  repositoryRoot: string;
  request: AssignmentTopologyChangeRequestV2;
  applyPlanId?: string;
  approvalHash?: string;
  reviewerId?: string;
}): Promise<MaterializeAssignmentTopologyResult> {
  const storage = await openProjectStorage(input.repositoryRoot);
  try {
    const inspected = await currentPlan(storage, input.request);
    if (input.applyPlanId === undefined) return { plan: inspected, receipt: null };
    if (input.approvalHash === undefined || input.reviewerId === undefined)
      throw new Error("Topology apply requires an exact approval and reviewer.");
    const approvedReviewerDigest = reviewerDigest(input.reviewerId);
    return await withAssignmentTopologyLock({
      repositoryRoot: storage.paths.repositoryRoot,
      operation: async () => {
        const fresh = await currentPlan(storage, input.request);
        if (fresh.planId !== input.applyPlanId)
          throw new Error("The assignment topology plan is stale.");
        if (fresh.approvalHash !== input.approvalHash)
          throw new Error("The assignment topology approval hash is stale.");
        if (fresh.status !== "ready")
          throw new Error(`The assignment topology change is ${fresh.status}.`);
        const before = await listAssignments(storage.paths.repositoryRoot);
        const prior = before.filter((item) => item.topology?.changeId === fresh.changeId);
        if (prior.some((item) => item.topology?.policyReview !== undefined))
          throw new Error("Manual topology review cannot resume an automatic policy decision.");
        if (prior.some((item) => item.topology?.reviewerIdDigest !== approvedReviewerDigest)) {
          throw new Error("Topology recovery requires the original reviewer identity.");
        }
        const nodeSetHash = assignmentTopologyDigest(
          input.request.nodes.map((node) => node.nodeKey).sort(),
        );
        for (const step of fresh.steps) {
          const node = input.request.nodes.find((item) => item.nodeKey === step.nodeKey)!;
          await createTopologyAssignment({
            repositoryRoot: storage.paths.repositoryRoot,
            taskType: node.taskType,
            roleId: node.roleId,
            roleVersion: node.roleVersion,
            roleContractHash: node.roleContractHash,
            requiredCapabilityHash: node.requiredCapabilityHash,
            priority: node.priority,
            dependencyIds: step.dependencyIds,
            acceptanceCriteria: node.acceptanceCriteria,
            verificationSuiteIds: node.verificationSuiteIds,
            approvalRequirements: node.approvalRequirements,
            expectedPaths: node.expectedPaths,
            workstreamId: fresh.workstreamId,
            topology: {
              contractVersion: 2,
              changeId: fresh.changeId,
              changeKey: fresh.changeKey,
              requestHash: fresh.requestHash,
              planId: fresh.planId,
              approvalHash: fresh.approvalHash,
              reviewerIdDigest: approvedReviewerDigest,
              expectedNodeCount: input.request.nodes.length,
              nodeSetHash,
              nodeKey: step.nodeKey,
            },
            recordEvent: (event) => recordWorkforceEvent(storage, event),
          });
        }
        const materialized = (await listAssignments(storage.paths.repositoryRoot)).filter(
          (item) => item.topology?.changeId === fresh.changeId,
        );
        if (
          materialized.length !== input.request.nodes.length ||
          assignmentTopologyDigest(materialized.map((item) => item.topology!.nodeKey).sort()) !==
            nodeSetHash
        ) {
          throw new Error("The topology change is incomplete and requires recovery.");
        }
        for (const assignment of materialized) {
          await activateTopologyAssignment({
            repositoryRoot: storage.paths.repositoryRoot,
            assignmentId: assignment.assignmentId,
            changeId: fresh.changeId,
          });
        }
        const beforeIds = new Set(before.map((item) => item.assignmentId));
        const assignmentIds = materialized.map((item) => item.assignmentId).sort();
        return {
          plan: fresh,
          receipt: {
            schemaVersion: 2,
            kind: "assignment_topology.applied",
            planId: fresh.planId,
            approvalHash: fresh.approvalHash,
            changeId: fresh.changeId,
            reviewerIdDigest: approvedReviewerDigest,
            status: "completed",
            createdAssignmentIds: assignmentIds.filter((id) => !beforeIds.has(id)),
            existingAssignmentIds: assignmentIds.filter((id) => beforeIds.has(id)),
          },
        };
      },
    });
  } finally {
    await storage.close();
  }
}
