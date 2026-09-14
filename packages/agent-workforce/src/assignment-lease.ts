import { repositoryPathWithinScope } from "@lervo/work-controller";
import {
  type WorkforceEventRecorder,
  type WorkforceAssignment,
  type WorkforceAgent,
} from "./types.js";
import {
  AGENT_ID,
  MINIMUM_LEASE_MS,
  MAXIMUM_LEASE_MS,
  fail,
  safePath,
} from "./workforce-state-validation.js";
import { readAssignmentState, assignmentPath, readAssignment } from "./assignment-state.js";
import { transition, retryConcurrent } from "./workforce-state-io.js";
import { listAgents } from "./agent-registry.js";

export async function renewAssignmentLeaseOnce(input: {
  repositoryRoot: string;
  assignmentId: string;
  agentId: string;
  leaseId: string;
  leaseDurationMs?: number;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAssignment> {
  const duration = input.leaseDurationMs ?? 5 * 60_000;
  if (
    !AGENT_ID.test(input.agentId) ||
    !Number.isSafeInteger(duration) ||
    duration < MINIMUM_LEASE_MS ||
    duration > MAXIMUM_LEASE_MS
  )
    fail("assignment_invalid", "The lease renewal coordinates are invalid.");
  const now = input.now ?? new Date();
  const assignmentState = await readAssignmentState(input.repositoryRoot, input.assignmentId);
  const assignment = assignmentState.value;
  exactLease(assignment, input.agentId, input.leaseId, now);
  const lease = {
    ...assignment.lease!,
    expiresAt: new Date(now.getTime() + duration).toISOString(),
  };
  // Renewal extends the same lease generation only; the responsibility binding pins the
  // assignment revision, so a renewal must not advance it.
  const next: WorkforceAssignment = {
    ...assignment,
    lease,
    updatedAt: now.toISOString(),
  };
  const target = await assignmentPath(input.repositoryRoot, assignment.assignmentId);
  return transition({
    path: target.path,
    lockPath: target.lockPath,
    now,
    content: `${JSON.stringify(next, null, 2)}\n`,
    result: structuredClone(next),
    expectedBefore: assignmentState.source,
    ...(input.recordEvent === undefined ? {} : { recordEvent: input.recordEvent }),
    event: {
      type: "assignment.lease.renewed",
      occurredAt: next.updatedAt,
      actorAgentId: input.agentId,
      payload: {
        assignmentId: assignment.assignmentId,
        agentId: input.agentId,
        leaseId: lease.leaseId,
        generation: lease.generation,
        expiresAt: lease.expiresAt,
      },
    },
  });
}

export function renewAssignmentLease(input: {
  repositoryRoot: string;
  assignmentId: string;
  agentId: string;
  leaseId: string;
  leaseDurationMs?: number;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAssignment> {
  return retryConcurrent(() => renewAssignmentLeaseOnce(input));
}

export function exactLease(
  assignment: WorkforceAssignment,
  agentId: string,
  leaseId: string,
  now: Date,
): void {
  if (
    assignment.status !== "leased" ||
    assignment.lease === null ||
    assignment.lease.agentId !== agentId ||
    assignment.lease.leaseId !== leaseId ||
    Date.parse(assignment.lease.expiresAt) <= now.getTime()
  )
    fail(
      "assignment_lease_conflict",
      "The assignment lease is absent, stale, expired, or owned by another agent.",
    );
}

export async function assertAssignmentExecutionAuthority(input: {
  repositoryRoot: string;
  assignmentId: string;
  agentId: string;
  leaseId: string;
  provider: "codex" | "claude";
  expectedPaths: string[];
  verificationSuiteIds: string[];
  now?: Date;
}): Promise<{ assignment: WorkforceAssignment; agent: WorkforceAgent }> {
  const now = input.now ?? new Date();
  const [assignment, agents] = await Promise.all([
    readAssignment(input.repositoryRoot, input.assignmentId),
    listAgents(input.repositoryRoot),
  ]);
  const agent = agents.find((item) => item.agentId === input.agentId);
  if (
    agent === undefined ||
    agent.status !== "active" ||
    agent.roleId !== assignment.roleId ||
    (agent.provider !== "any" && agent.provider !== input.provider)
  )
    fail(
      "agent_state_conflict",
      "The managed run agent, role, status, or provider does not match the assignment.",
    );
  if (
    agent.roleVersion !== assignment.roleVersion ||
    agent.roleContractHash !== assignment.roleContractHash
  )
    fail("agent_state_conflict", "The managed run agent and assignment role contracts differ.");
  exactLease(assignment, input.agentId, input.leaseId, now);
  const expectedPaths = [...new Set(input.expectedPaths)].sort();
  const suites = [...new Set(input.verificationSuiteIds)].sort();
  if (
    expectedPaths.length !== input.expectedPaths.length ||
    !expectedPaths.every(safePath) ||
    !expectedPaths.every((path) =>
      assignment.expectedPaths.some((scope) => repositoryPathWithinScope(path, scope)),
    ) ||
    JSON.stringify(suites) !== JSON.stringify([...assignment.verificationSuiteIds].sort())
  )
    fail(
      "assignment_path_conflict",
      "The managed run paths or verification suites differ from the leased assignment.",
    );
  return { assignment: structuredClone(assignment), agent: structuredClone(agent) };
}
