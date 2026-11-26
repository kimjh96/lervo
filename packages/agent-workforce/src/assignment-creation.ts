import type { CreateAssignmentInput } from "./assignment-creation-contract.js";
import { validateAssignmentCreation } from "./assignment-creation-validation.js";
import {
  convergenceAssignmentId,
  convergenceAssignmentMatches,
  convergenceAssignmentEventCoordinates,
} from "./assignment-convergence-state.js";
import {
  type WorkforceAssignmentRoutineProvenance,
  type WorkforceAssignmentTopologyProvenance,
  type WorkforceEventRecorder,
  type WorkforceAssignment,
} from "./types.js";
import { resolveRoleContract } from "@lervo/roles";
import { state, transition, retryConcurrent, workforceStateFits } from "./workforce-state-io.js";
import { listAssignments, assignmentPath } from "./assignment-state.js";
import { fail, id, validAssignment, digest, stableJson } from "./workforce-state-validation.js";
import { workforceLimits } from "./limits.js";
import {
  routineAssignmentId,
  routineAssignmentMatches,
  routineAssignmentEventCoordinates,
} from "./assignment-routine-state.js";
import {
  topologyAssignmentId,
  topologyAssignmentMatches,
  topologyAssignmentEventCoordinates,
} from "./assignment-topology-state.js";
import {
  knowledgeJobAssignmentId,
  knowledgeJobAssignmentMatches,
  knowledgeJobAssignmentEventCoordinates,
} from "./assignment-knowledge-job-state.js";
import { randomUUID } from "node:crypto";

export async function createAssignmentOnce(
  input: CreateAssignmentInput,
): Promise<WorkforceAssignment> {
  const now = input.now ?? new Date();
  const contract = await resolveRoleContract(input.repositoryRoot, input.roleId);
  const current = await state(input.repositoryRoot);
  const assignments = await listAssignments(input.repositoryRoot);
  const { dependencyIds, expectedPaths, verificationSuiteIds, approvalRequirements } =
    validateAssignmentCreation(input, contract, assignments);
  const createdAt = now.toISOString();
  const assignmentId =
    input.convergence != null
      ? convergenceAssignmentId(current.manifest.projectId, input.convergence)
      : input.knowledgeJob !== undefined && input.knowledgeJob !== null
        ? knowledgeJobAssignmentId(current.manifest.projectId, input.knowledgeJob)
        : input.topology !== undefined && input.topology !== null
          ? topologyAssignmentId(current.manifest.projectId, input.topology)
          : input.routine === undefined || input.routine === null
            ? id("asn", { projectId: current.manifest.projectId, nonce: randomUUID() })
            : routineAssignmentId(current.manifest.projectId, input.routine);
  const existing = assignments.find((item) => item.assignmentId === assignmentId);
  if (existing !== undefined) {
    const exact =
      input.convergence != null
        ? convergenceAssignmentMatches(existing, {
            taskType: input.taskType,
            roleId: input.roleId,
            roleVersion: contract.version,
            roleContractHash: contract.contractHash,
            requiredCapabilityHash: input.requiredCapabilityHash ?? null,
            convergence: input.convergence,
            priority: input.priority ?? 50,
            dependencyIds,
            acceptanceCriteria: input.acceptanceCriteria,
            verificationSuiteIds,
            approvalRequirements,
            expectedPaths,
            accessMode: input.accessMode ?? "write",
            workstreamId: input.workstreamId ?? null,
          })
        : input.workstreamId !== undefined &&
            input.knowledgeJob !== undefined &&
            input.knowledgeJob !== null
          ? knowledgeJobAssignmentMatches(existing, {
              taskType: input.taskType,
              roleId: input.roleId,
              roleVersion: contract.version,
              roleContractHash: contract.contractHash,
              requiredCapabilityHash: input.requiredCapabilityHash ?? null,
              knowledgeJob: input.knowledgeJob,
              priority: input.priority ?? 50,
              dependencyIds,
              acceptanceCriteria: input.acceptanceCriteria,
              verificationSuiteIds,
              approvalRequirements,
              expectedPaths,
              accessMode: input.accessMode ?? "write",
              workstreamId: input.workstreamId,
            })
          : input.workstreamId !== undefined &&
              input.topology !== undefined &&
              input.topology !== null
            ? topologyAssignmentMatches(existing, {
                taskType: input.taskType,
                roleId: input.roleId,
                roleVersion: contract.version,
                roleContractHash: contract.contractHash,
                requiredCapabilityHash: input.requiredCapabilityHash ?? null,
                topology: input.topology,
                priority: input.priority ?? 50,
                dependencyIds,
                acceptanceCriteria: input.acceptanceCriteria,
                verificationSuiteIds,
                approvalRequirements,
                expectedPaths,
                workstreamId: input.workstreamId,
              })
            : input.routine !== undefined &&
              input.routine !== null &&
              input.workstreamId !== undefined &&
              routineAssignmentMatches(existing, {
                taskType: input.taskType,
                roleId: input.roleId,
                roleVersion: contract.version,
                roleContractHash: contract.contractHash,
                requiredCapabilityHash: input.requiredCapabilityHash ?? null,
                routine: input.routine,
                priority: input.priority ?? 50,
                dependencyIds,
                acceptanceCriteria: input.acceptanceCriteria,
                verificationSuiteIds,
                approvalRequirements,
                expectedPaths,
                workstreamId: input.workstreamId,
              });
    if (!exact) fail("assignment_invalid", "The deterministic assignment ID is already in use.");
    return structuredClone(existing);
  }
  if (assignments.length >= workforceLimits.maximumAssignments)
    fail("assignment_invalid", "The assignment capacity is exhausted.");
  const assignment: WorkforceAssignment = {
    schemaVersion: 1,
    assignmentId,
    projectId: current.manifest.projectId,
    taskType: input.taskType,
    roleId: input.roleId,
    roleVersion: contract.version,
    roleContractHash: contract.contractHash,
    requiredCapabilityHash: input.requiredCapabilityHash ?? null,
    routine: input.routine ?? null,
    topology: input.topology ?? null,
    knowledgeJob: input.knowledgeJob ?? null,
    ...(input.convergence == null ? {} : { convergence: input.convergence }),
    status: input.initialStatus ?? "queued",
    priority: input.priority ?? 50,
    dependencyIds,
    acceptanceCriteria: [...input.acceptanceCriteria],
    verificationSuiteIds,
    approvalRequirements,
    expectedPaths,
    accessMode: input.accessMode ?? "write",
    workstreamId: input.workstreamId ?? null,
    assigneeAgentId: null,
    lease: null,
    handoffs: [],
    resultArtifacts: [],
    failureCode: null,
    revision: 1,
    createdAt,
    updatedAt: createdAt,
  };
  const content = creatableContent(assignment, current.manifest.projectId);
  const target = await assignmentPath(input.repositoryRoot, assignment.assignmentId);
  return transition({
    path: target.path,
    lockPath: target.lockPath,
    now,
    content,
    result: structuredClone(assignment),
    expectedBefore: null,
    ...(input.recordEvent === undefined ? {} : { recordEvent: input.recordEvent }),
    event: {
      type: "assignment.created",
      occurredAt: createdAt,
      actorAgentId: null,
      payload: {
        assignmentId: assignment.assignmentId,
        taskType: assignment.taskType,
        roleId: assignment.roleId,
        roleVersion: assignment.roleVersion,
        roleContractHash: assignment.roleContractHash,
        ...routineAssignmentEventCoordinates(assignment),
        ...knowledgeJobAssignmentEventCoordinates(assignment),
        ...convergenceAssignmentEventCoordinates(assignment),
        ...(assignment.topology === null
          ? {}
          : {
              ...topologyAssignmentEventCoordinates(assignment),
              initialStatus: assignment.status,
            }),
        priority: assignment.priority,
        dependencyIds,
        expectedPathDigest: digest(stableJson(expectedPaths)),
        accessMode: input.accessMode ?? "write",
        acceptanceDigest: digest(stableJson(input.acceptanceCriteria)),
        verificationDigest: digest(stableJson(verificationSuiteIds)),
        approvalDigest: digest(stableJson(approvalRequirements)),
        workstreamId: assignment.workstreamId,
      },
    },
  });
}

/** The new record's bytes, refused when invalid or past the state bound every reader enforces. */
function creatableContent(assignment: WorkforceAssignment, projectId: string): string {
  const content = `${JSON.stringify(assignment, null, 2)}\n`;
  if (!validAssignment(assignment, projectId) || !workforceStateFits(content))
    fail("assignment_invalid", "The assignment is invalid or exceeds the state bound.");
  return content;
}

export function createAssignment(input: {
  repositoryRoot: string;
  taskType: string;
  roleId: string;
  priority?: number;
  dependencyIds?: string[];
  acceptanceCriteria: string[];
  verificationSuiteIds: string[];
  approvalRequirements?: string[];
  expectedPaths: string[];
  workstreamId?: string;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAssignment> {
  return retryConcurrent(() => createAssignmentOnce(input));
}

export function createRoutineAssignment(input: {
  repositoryRoot: string;
  taskType: string;
  roleId: string;
  roleVersion: string;
  roleContractHash: string;
  requiredCapabilityHash: string | null;
  priority: number;
  dependencyIds: string[];
  acceptanceCriteria: string[];
  verificationSuiteIds: string[];
  approvalRequirements: string[];
  expectedPaths: string[];
  workstreamId: string;
  routine: WorkforceAssignmentRoutineProvenance;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAssignment> {
  return retryConcurrent(() =>
    createAssignmentOnce({
      ...input,
      expectedRoleVersion: input.roleVersion,
      expectedRoleContractHash: input.roleContractHash,
    }),
  );
}

export function createTopologyAssignment(input: {
  repositoryRoot: string;
  taskType: string;
  roleId: string;
  roleVersion: string;
  roleContractHash: string;
  requiredCapabilityHash: string | null;
  priority: number;
  dependencyIds: string[];
  acceptanceCriteria: string[];
  verificationSuiteIds: string[];
  approvalRequirements: string[];
  expectedPaths: string[];
  workstreamId: string;
  topology: WorkforceAssignmentTopologyProvenance;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAssignment> {
  return retryConcurrent(() =>
    createAssignmentOnce({
      ...input,
      initialStatus: "blocked",
      expectedRoleVersion: input.roleVersion,
      expectedRoleContractHash: input.roleContractHash,
    }),
  );
}

export { activateTopologyAssignment } from "./assignment-topology-activation.js";
export {
  withAssignmentRoutineLock,
  withAssignmentTopologyLock,
} from "./assignment-materialization-lock.js";
