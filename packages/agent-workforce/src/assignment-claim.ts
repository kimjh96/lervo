import { nextAssignmentLeaseGeneration } from "./assignment-lease-generation.js";
import { assignmentAccessMode } from "./assignment-access-mode.js";
import { type WorkResponsibilityV1 } from "@lervo/application-contract";
import {
  type WorkforceAgent,
  type WorkforceEventRecorder,
  type WorkforceAssignment,
} from "./types.js";
import {
  AGENT_ID,
  SESSION_ID,
  fail,
  MINIMUM_LEASE_MS,
  MAXIMUM_LEASE_MS,
  id,
  digest,
  stableJson,
} from "./workforce-state-validation.js";
import { listAgents } from "./agent-registry.js";
import { judgeAssignmentPathConflicts } from "./assignment-path-conflict.js";
import { readAssignmentClaimPathHolders } from "./conversation-path-holders.js";
import { assignmentPath, readAssignmentState, listAssignments } from "./assignment-state.js";
import { acquireLock, atomicWrite, retryConcurrent } from "./workforce-state-io.js";
import {
  repositoryPathWithinScope,
  assertWorkResponsibility,
  operatingContractHash,
  evaluateResponsibilityClaimScope,
} from "@lervo/work-controller";
import { randomUUID } from "node:crypto";

export async function claimAssignmentOnce(input: {
  repositoryRoot: string;
  assignmentId: string;
  expectedRevision?: number;
  responsibilityBinding?: WorkResponsibilityV1;
  agentId: string;
  sessionId: string;
  leaseDurationMs?: number;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAssignment> {
  if (!AGENT_ID.test(input.agentId) || !SESSION_ID.test(input.sessionId))
    fail("assignment_invalid", "The claim coordinates are invalid.");
  const duration = input.leaseDurationMs ?? 5 * 60_000;
  if (!Number.isSafeInteger(duration) || duration < MINIMUM_LEASE_MS || duration > MAXIMUM_LEASE_MS)
    fail("assignment_invalid", "The lease duration is invalid.");
  const now = input.now ?? new Date();
  const agents = await listAgents(input.repositoryRoot);
  const agent = agents.find((item) => item.agentId === input.agentId);
  if (agent === undefined || agent.status !== "active")
    fail("agent_state_conflict", "Only an active agent can claim an assignment.");
  const target = await assignmentPath(input.repositoryRoot, input.assignmentId);
  const release = await acquireLock(target.lockPath, now);
  try {
    const assignmentState = await readAssignmentState(input.repositoryRoot, input.assignmentId);
    const assignment = assignmentState.value;
    if (input.expectedRevision !== undefined && assignment.revision !== input.expectedRevision) {
      fail("agent_state_conflict", "The assignment revision changed before claim.");
    }
    const binding = input.responsibilityBinding;
    if (assignment.topology?.policyReview !== undefined && binding === undefined)
      fail("assignment_lease_conflict", "Automatic topology requires a responsibility binding.");
    if (binding !== undefined) {
      assertWorkResponsibility(binding);
      if (
        (assignment.status === "queued" &&
          assignment.recovery === undefined &&
          assignment.amendment !== undefined &&
          operatingContractHash(binding) !== assignment.amendment.successorResponsibilityHash) ||
        input.recordEvent === undefined ||
        binding.executorAgentId !== input.agentId ||
        evaluateResponsibilityClaimScope(assignment, binding).length !== 0
      )
        fail("assignment_lease_conflict", "The responsibility does not bind the resulting claim.");
    }
    const all = await listAssignments(input.repositoryRoot);
    assertAgentBinding(assignment, agent);
    if (
      !assignment.expectedPaths.every((path) =>
        agent.responsibilityPaths.some((scope) => repositoryPathWithinScope(path, scope)),
      )
    )
      fail("assignment_path_conflict", "The assignment is outside the agent responsibility scope.");
    if (
      assignment.dependencyIds.some(
        (dependencyId) =>
          all.find((item) => item.assignmentId === dependencyId)?.status !== "completed",
      )
    )
      fail("assignment_dependency_blocked", "An assignment dependency is not complete.");
    const currentLeaseActive =
      assignment.lease !== null && Date.parse(assignment.lease.expiresAt) > now.getTime();
    const claimableStatuses =
      binding !== undefined && assignment.topology?.policyReview !== undefined
        ? ["blocked", "queued", "leased"]
        : ["queued", "leased"];
    if (currentLeaseActive || !claimableStatuses.includes(assignment.status))
      fail("assignment_lease_conflict", "The assignment is not claimable.");
    // Other conversations' unsealed changes hold too (Lervo ADE coordination, "Conflicts").
    const paths = assignment.expectedPaths;
    const changedPathHolders = await readAssignmentClaimPathHolders({
      repositoryRoot: input.repositoryRoot,
      workforceDirectory: target.workforceDirectory,
      paths,
      assignments: all,
      now,
    });
    const judged = { claimant: assignment, paths, assignments: all, now, changedPathHolders };
    if (judgeAssignmentPathConflicts(judged).length !== 0)
      fail(
        "assignment_path_conflict",
        "Another active assignment owns an overlapping repository path.",
      );
    const generation = nextAssignmentLeaseGeneration(assignment);
    const lease = {
      leaseId: id("lse", {
        assignmentId: assignment.assignmentId,
        generation,
        nonce: randomUUID(),
      }),
      agentId: agent.agentId,
      sessionId: input.sessionId,
      generation,
      acquiredAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + duration).toISOString(),
    };
    const next: WorkforceAssignment = {
      ...assignment,
      status: "leased",
      assigneeAgentId: agent.agentId,
      lease,
      lastLeaseGeneration: generation,
      revision: assignment.revision + 1,
      updatedAt: now.toISOString(),
    };
    const before = assignmentState.source;
    await atomicWrite(target.path, `${JSON.stringify(next, null, 2)}\n`);
    try {
      await input.recordEvent?.({
        type: "assignment.claimed",
        occurredAt: next.updatedAt,
        actorAgentId: agent.agentId,
        payload: {
          assignmentId: next.assignmentId,
          agentId: agent.agentId,
          leaseId: lease.leaseId,
          generation,
          expiresAt: lease.expiresAt,
          expectedPathDigest: digest(stableJson(next.expectedPaths)),
          accessMode: assignmentAccessMode(next),
        },
      });
    } catch (error) {
      await atomicWrite(target.path, before);
      fail(
        "workforce_write_failed",
        "The assignment claim event failed and state was restored.",
        error,
      );
    }
    return structuredClone(next);
  } finally {
    await release();
  }
}

/** The agent's role, knowledge binding, role contract, and capabilities fit the assignment. */
function assertAgentBinding(assignment: WorkforceAssignment, agent: WorkforceAgent): void {
  if (assignment.roleId !== agent.roleId)
    fail("assignment_lease_conflict", "The agent role does not match the assignment role.");
  if (
    (assignment.knowledgeJob != null && assignment.knowledgeJob.agentId !== agent.agentId) ||
    (assignment.convergence != null && assignment.convergence.agentId !== agent.agentId)
  )
    fail("assignment_lease_conflict", "The knowledge job is bound to another agent.");
  if (
    assignment.roleVersion !== agent.roleVersion ||
    assignment.roleContractHash !== agent.roleContractHash
  )
    fail("assignment_lease_conflict", "The agent and assignment role contracts differ.");
  if (
    assignment.requiredCapabilityHash !== undefined &&
    assignment.requiredCapabilityHash !== null &&
    assignment.requiredCapabilityHash !== agent.capabilityHash
  )
    fail("assignment_lease_conflict", "The agent capability binding differs from the assignment.");
}

export function claimAssignment(input: {
  repositoryRoot: string;
  assignmentId: string;
  expectedRevision?: number;
  responsibilityBinding?: WorkResponsibilityV1;
  agentId: string;
  sessionId: string;
  leaseDurationMs?: number;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAssignment> {
  return retryConcurrent(() => claimAssignmentOnce(input));
}
