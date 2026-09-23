import {
  type WorkforceAssignmentRoutineProvenance,
  type WorkforceAssignmentTopologyProvenance,
  type WorkforceAssignmentKnowledgeJobProvenance,
  type WorkforceEventRecorder,
  type WorkforceAssignment,
} from "./types.js";
import { resolveRoleContract } from "@lervo/roles";
import { state, transition, retryConcurrent, acquireLock } from "./workforce-state-io.js";
import { listAssignments, assignmentPath, readAssignmentState } from "./assignment-state.js";
import {
  fail,
  boundedStrings,
  ASSIGNMENT_ID,
  safePath,
  WORKSTREAM_ID,
  HASH,
  id,
  validAssignment,
  digest,
  stableJson,
} from "./workforce-state-validation.js";
import { workforceLimits } from "./limits.js";
import {
  validWorkforceRoutineProvenance,
  routineAssignmentId,
  routineAssignmentMatches,
  routineAssignmentEventCoordinates,
} from "./assignment-routine-state.js";
import {
  validWorkforceTopologyProvenance,
  topologyAssignmentId,
  topologyAssignmentMatches,
  topologyAssignmentEventCoordinates,
} from "./assignment-topology-state.js";
import {
  validKnowledgeJobProvenance,
  knowledgeJobAssignmentId,
  knowledgeJobAssignmentMatches,
  knowledgeJobAssignmentEventCoordinates,
} from "./assignment-knowledge-job-state.js";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

export async function createAssignmentOnce(input: {
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
  requiredCapabilityHash?: string | null;
  routine?: WorkforceAssignmentRoutineProvenance | null;
  topology?: WorkforceAssignmentTopologyProvenance | null;
  knowledgeJob?: WorkforceAssignmentKnowledgeJobProvenance | null;
  initialStatus?: "queued" | "blocked";
  expectedRoleVersion?: string;
  expectedRoleContractHash?: string;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAssignment> {
  const now = input.now ?? new Date();
  const contract = await resolveRoleContract(input.repositoryRoot, input.roleId);
  const current = await state(input.repositoryRoot);
  const assignments = await listAssignments(input.repositoryRoot);
  if (
    (input.expectedRoleVersion !== undefined && input.expectedRoleVersion !== contract.version) ||
    (input.expectedRoleContractHash !== undefined &&
      input.expectedRoleContractHash !== contract.contractHash)
  )
    fail("assignment_invalid", "The assignment role contract binding is stale.");
  if (!/^[a-z][a-z0-9._-]{1,99}$/u.test(input.taskType))
    fail("assignment_invalid", "The assignment task type is invalid.");
  const dependencyIds = [...new Set(input.dependencyIds ?? [])].sort();
  const expectedPaths = [...new Set(input.expectedPaths)].sort();
  const verificationSuiteIds = [...new Set(input.verificationSuiteIds)].sort();
  const approvalRequirements = [...new Set(input.approvalRequirements ?? [])].sort();
  if (
    !boundedStrings(dependencyIds, workforceLimits.maximumAssignmentDependencies, ASSIGNMENT_ID) ||
    !boundedStrings(input.acceptanceCriteria, 32) ||
    !boundedStrings(verificationSuiteIds, 32) ||
    !boundedStrings(approvalRequirements, 32) ||
    !boundedStrings(expectedPaths, 128) ||
    !expectedPaths.every(safePath) ||
    input.acceptanceCriteria.length === 0 ||
    verificationSuiteIds.length === 0 ||
    expectedPaths.length === 0 ||
    (input.workstreamId !== undefined && !WORKSTREAM_ID.test(input.workstreamId)) ||
    (input.requiredCapabilityHash !== undefined &&
      input.requiredCapabilityHash !== null &&
      !HASH.test(input.requiredCapabilityHash)) ||
    (input.routine !== undefined &&
      input.routine !== null &&
      !validWorkforceRoutineProvenance(input.routine)) ||
    (input.routine !== undefined && input.routine !== null && input.workstreamId === undefined) ||
    (input.topology !== undefined &&
      input.topology !== null &&
      (!validWorkforceTopologyProvenance(input.topology) || input.workstreamId === undefined)) ||
    (input.knowledgeJob !== undefined &&
      input.knowledgeJob !== null &&
      (!validKnowledgeJobProvenance(input.knowledgeJob) || input.workstreamId === undefined)) ||
    [input.routine, input.topology, input.knowledgeJob].filter((item) => item != null).length > 1 ||
    (input.routine !== undefined &&
      input.routine !== null &&
      input.topology !== undefined &&
      input.topology !== null) ||
    (input.initialStatus === "blocked" && (input.topology === undefined || input.topology === null))
  )
    fail(
      "assignment_invalid",
      "Assignment dependencies, criteria, verification, approval, paths, or workstream are invalid.",
    );
  if (
    dependencyIds.some(
      (dependencyId) => !assignments.some((assignment) => assignment.assignmentId === dependencyId),
    )
  )
    fail("assignment_invalid", "An assignment dependency does not exist.");
  const createdAt = now.toISOString();
  const assignmentId =
    input.knowledgeJob !== undefined && input.knowledgeJob !== null
      ? knowledgeJobAssignmentId(current.manifest.projectId, input.knowledgeJob)
      : input.topology !== undefined && input.topology !== null
        ? topologyAssignmentId(current.manifest.projectId, input.topology)
        : input.routine === undefined || input.routine === null
          ? id("asn", { projectId: current.manifest.projectId, nonce: randomUUID() })
          : routineAssignmentId(current.manifest.projectId, input.routine);
  const existing = assignments.find((item) => item.assignmentId === assignmentId);
  if (existing !== undefined) {
    const exact =
      input.workstreamId !== undefined &&
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
    status: input.initialStatus ?? "queued",
    priority: input.priority ?? 50,
    dependencyIds,
    acceptanceCriteria: [...input.acceptanceCriteria],
    verificationSuiteIds,
    approvalRequirements,
    expectedPaths,
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
  if (!validAssignment(assignment, current.manifest.projectId))
    fail("assignment_invalid", "The assignment is invalid.");
  const target = await assignmentPath(input.repositoryRoot, assignment.assignmentId);
  return transition({
    path: target.path,
    lockPath: target.lockPath,
    now,
    content: `${JSON.stringify(assignment, null, 2)}\n`,
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
        ...(assignment.topology === null
          ? {}
          : {
              ...topologyAssignmentEventCoordinates(assignment),
              initialStatus: assignment.status,
            }),
        priority: assignment.priority,
        dependencyIds,
        expectedPathDigest: digest(stableJson(expectedPaths)),
        acceptanceDigest: digest(stableJson(input.acceptanceCriteria)),
        verificationDigest: digest(stableJson(verificationSuiteIds)),
        approvalDigest: digest(stableJson(approvalRequirements)),
        workstreamId: assignment.workstreamId,
      },
    },
  });
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

export function activateTopologyAssignment(input: {
  repositoryRoot: string;
  assignmentId: string;
  changeId: string;
  now?: Date;
}): Promise<WorkforceAssignment> {
  return retryConcurrent(async () => {
    const now = input.now ?? new Date();
    const target = await assignmentPath(input.repositoryRoot, input.assignmentId);
    const current = await readAssignmentState(input.repositoryRoot, input.assignmentId);
    if (current.value.topology?.changeId !== input.changeId)
      fail("assignment_invalid", "The assignment topology change binding is stale.");
    if (current.value.topology.policyReview !== undefined)
      fail("assignment_invalid", "Automatic topology requires a fenced responsibility claim.");
    if (current.value.status !== "blocked") return structuredClone(current.value);
    const assignment: WorkforceAssignment = {
      ...current.value,
      status: "queued",
      revision: current.value.revision + 1,
      updatedAt: now.toISOString(),
    };
    return transition({
      path: target.path,
      lockPath: target.lockPath,
      now,
      content: `${JSON.stringify(assignment, null, 2)}\n`,
      result: structuredClone(assignment),
      expectedBefore: current.source,
    });
  });
}

export function withAssignmentRoutineLock<T>(input: {
  repositoryRoot: string;
  operation: () => Promise<T>;
  now?: Date;
}): Promise<T> {
  return retryConcurrent(async () => {
    const current = await state(input.repositoryRoot);
    const release = await acquireLock(
      resolve(current.base, "graph-materialization.lock"),
      input.now ?? new Date(),
    );
    try {
      return await input.operation();
    } finally {
      await release();
    }
  });
}

export const withAssignmentTopologyLock = withAssignmentRoutineLock;
