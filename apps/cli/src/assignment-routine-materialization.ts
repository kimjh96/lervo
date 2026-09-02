import type {
  AssignmentRoutineApplyReceiptV1,
  AssignmentRoutineAssignmentObservationV1,
  AssignmentRoutinePlanV1,
  AssignmentRoutineRequestV1,
  AssignmentRoutineRoleContractV1,
} from "@lervo/application-contract";
import {
  createRoutineAssignment,
  listAssignments,
  withAssignmentRoutineLock,
  type WorkforceAssignment,
} from "@lervo/agent-workforce";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import { resolveRoleContract } from "@lervo/roles";
import { assignmentRoutineDigest, createAssignmentRoutinePlan } from "@lervo/work-controller";

import { recordWorkforceEvent } from "./workforce-events.js";
import { verifiedCurrentWorkstream } from "./workstream-services.js";

function observation(assignment: WorkforceAssignment): AssignmentRoutineAssignmentObservationV1 {
  return {
    assignmentId: assignment.assignmentId,
    revision: assignment.revision,
    status: assignment.status,
    taskType: assignment.taskType,
    roleId: assignment.roleId,
    roleVersion: assignment.roleVersion,
    roleContractHash: assignment.roleContractHash,
    requiredCapabilityHash: assignment.requiredCapabilityHash ?? null,
    priority: assignment.priority,
    dependencyIds: [...assignment.dependencyIds].sort(),
    acceptanceDigest: assignmentRoutineDigest(assignment.acceptanceCriteria),
    verificationDigest: assignmentRoutineDigest([...assignment.verificationSuiteIds].sort()),
    approvalDigest: assignmentRoutineDigest([...assignment.approvalRequirements].sort()),
    expectedPathDigest: assignmentRoutineDigest([...assignment.expectedPaths].sort()),
    routine: assignment.routine ?? null,
  };
}

async function currentPlan(
  storage: ProjectStorage,
  request: AssignmentRoutineRequestV1,
): Promise<{ plan: AssignmentRoutinePlanV1; assignments: WorkforceAssignment[] }> {
  const workstream = await verifiedCurrentWorkstream(storage);
  if (workstream === null || workstream.status !== "active")
    throw new Error("Assignment routine materialization requires a verified active workstream.");
  const assignments = await listAssignments(storage.paths.repositoryRoot);
  createAssignmentRoutinePlan({
    projectId: storage.manifest.projectId,
    currentWorkstreamId: workstream.workstreamId,
    request,
    roleContracts: [],
    assignments: assignments.map(observation),
  });
  const roleContracts: AssignmentRoutineRoleContractV1[] = [];
  for (const roleId of [...new Set(request.template.nodes.map((node) => node.roleId))].sort()) {
    const contract = await resolveRoleContract(storage.paths.repositoryRoot, roleId);
    roleContracts.push({
      roleId,
      roleVersion: contract.version,
      roleContractHash: contract.contractHash,
    });
  }
  return {
    plan: createAssignmentRoutinePlan({
      projectId: storage.manifest.projectId,
      currentWorkstreamId: workstream.workstreamId,
      request,
      roleContracts,
      assignments: assignments.map(observation),
    }),
    assignments,
  };
}

export interface MaterializeAssignmentRoutineResult {
  plan: AssignmentRoutinePlanV1;
  receipt: AssignmentRoutineApplyReceiptV1 | null;
}

export async function materializeAssignmentRoutine(input: {
  repositoryRoot: string;
  request: AssignmentRoutineRequestV1;
  applyPlanId?: string;
}): Promise<MaterializeAssignmentRoutineResult> {
  const storage = await openProjectStorage(input.repositoryRoot);
  try {
    const inspected = await currentPlan(storage, input.request);
    if (input.applyPlanId === undefined) return { plan: inspected.plan, receipt: null };
    return await withAssignmentRoutineLock({
      repositoryRoot: storage.paths.repositoryRoot,
      operation: async () => {
        const fresh = await currentPlan(storage, input.request);
        if (fresh.plan.planId !== input.applyPlanId)
          throw new Error("The assignment routine plan is stale.");
        if (fresh.plan.status !== "ready")
          throw new Error(`The assignment routine is ${fresh.plan.status}.`);
        const existingIds = new Set(fresh.assignments.map((assignment) => assignment.assignmentId));
        const createdAssignmentIds: string[] = [];
        const existingAssignmentIds: string[] = [];
        for (const step of fresh.plan.steps) {
          const node = input.request.template.nodes.find((item) => item.nodeKey === step.nodeKey)!;
          const assignment = await createRoutineAssignment({
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
            workstreamId: fresh.plan.workstreamId,
            routine: {
              routineId: fresh.plan.routineId,
              templateVersion: fresh.plan.templateVersion,
              templateHash: fresh.plan.templateHash,
              invocationId: fresh.plan.invocationId,
              triggerKind: input.request.trigger.kind,
              triggerDigest: fresh.plan.triggerDigest,
              nodeKey: step.nodeKey,
            },
            recordEvent: (event) => recordWorkforceEvent(storage, event),
          });
          (existingIds.has(assignment.assignmentId)
            ? existingAssignmentIds
            : createdAssignmentIds
          ).push(assignment.assignmentId);
        }
        return {
          plan: fresh.plan,
          receipt: {
            schemaVersion: 1,
            planId: fresh.plan.planId,
            invocationId: fresh.plan.invocationId,
            status: "completed",
            createdAssignmentIds,
            existingAssignmentIds,
          },
        };
      },
    });
  } finally {
    await storage.close();
  }
}
