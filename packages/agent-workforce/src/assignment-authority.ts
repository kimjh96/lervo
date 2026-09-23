import { repositoryPathWithinScope } from "@lervo/work-controller";

import { listAgents } from "./agent-registry.js";
import { assignmentAccessMode } from "./assignment-access-mode.js";
import { exactLease } from "./assignment-lease.js";
import { readAssignment } from "./assignment-state.js";
import { fail, safePath, stableJson } from "./workforce-state-validation.js";
import type {
  WorkforceAgent,
  WorkforceAssignment,
  WorkforceAssignmentKnowledgeJobProvenance,
} from "./types.js";

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
  const { assignment, agent } = await leasedAssignmentAuthority(input);
  if (assignmentAccessMode(assignment) !== "write")
    fail("assignment_lease_conflict", "A read-only assignment cannot authorize repository writes.");
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
  return { assignment, agent };
}

export async function assertReadOnlyKnowledgeReviewAuthority(input: {
  repositoryRoot: string;
  assignmentId: string;
  agentId: string;
  leaseId: string;
  provider: "codex" | "claude";
  sourcePaths: string[];
  verificationSuiteIds: string[];
  knowledgeJob: WorkforceAssignmentKnowledgeJobProvenance;
  now?: Date;
}): Promise<{ assignment: WorkforceAssignment; agent: WorkforceAgent }> {
  const { assignment, agent } = await leasedAssignmentAuthority(input);
  const sourcePaths = [...new Set(input.sourcePaths)].sort();
  const suites = [...new Set(input.verificationSuiteIds)].sort();
  if (
    assignmentAccessMode(assignment) !== "read_only" ||
    assignment.knowledgeJob == null ||
    assignment.knowledgeJob.agentId !== input.agentId ||
    stableJson(assignment.knowledgeJob) !== stableJson(input.knowledgeJob) ||
    sourcePaths.length !== input.sourcePaths.length ||
    JSON.stringify(sourcePaths) !== JSON.stringify([...assignment.expectedPaths].sort()) ||
    JSON.stringify(suites) !== JSON.stringify([...assignment.verificationSuiteIds].sort())
  )
    fail(
      "assignment_lease_conflict",
      "The read-only knowledge review differs from its source-scoped assignment.",
    );
  return { assignment, agent };
}

async function leasedAssignmentAuthority(input: {
  repositoryRoot: string;
  assignmentId: string;
  agentId: string;
  leaseId: string;
  provider: "codex" | "claude";
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
  if (
    assignment.requiredCapabilityHash != null &&
    assignment.requiredCapabilityHash !== agent.capabilityHash
  )
    fail("agent_state_conflict", "The agent capability binding differs from the assignment.");
  exactLease(assignment, input.agentId, input.leaseId, now);
  return { assignment: structuredClone(assignment), agent: structuredClone(agent) };
}
