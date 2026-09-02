import { assertRoleContractBinding, resolveRoleContract } from "@lervo/roles";
import {
  createAssignmentMentionRoutePlan,
  listAgents,
  listAssignments,
  recordAssignmentHandoff,
  type AssignmentMentionRoutePlan,
  type AssignmentMentionTarget,
  type WorkforceArtifactReference,
} from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";

import { recordWorkforceEvent } from "./workforce-events.js";
import { verifiedCurrentWorkstream } from "./workstream-services.js";

export interface RouteAssignmentMentionInput {
  repositoryRoot: string;
  assignmentId: string;
  fromAgentId: string;
  leaseId: string;
  target: AssignmentMentionTarget;
  requestDigest: string;
  artifactReferences: WorkforceArtifactReference[];
  contextEvidenceEventIds: string[];
  applyPlanId?: string;
  observedAt?: Date;
}

export interface RouteAssignmentMentionResult {
  plan: AssignmentMentionRoutePlan;
  appliedHandoffId: string | null;
}

export async function routeAssignmentMention(
  input: RouteAssignmentMentionInput,
): Promise<RouteAssignmentMentionResult> {
  const storage = await openProjectStorage(input.repositoryRoot);
  try {
    const now = input.observedAt ?? new Date();
    const workstream = await verifiedCurrentWorkstream(storage);
    if (workstream === null || workstream.status !== "active") {
      throw new Error("Assignment mention routing requires a verified active workstream.");
    }
    const [assignments, agents] = await Promise.all([
      listAssignments(storage.paths.repositoryRoot),
      listAgents(storage.paths.repositoryRoot),
    ]);
    const assignment = assignments.find((item) => item.assignmentId === input.assignmentId);
    const source = agents.find((item) => item.agentId === input.fromAgentId);
    if (assignment === undefined) throw new Error("The mention names an unknown assignment.");
    if (source === undefined) throw new Error("The mention names an unknown source agent.");
    const sourceContract = await resolveRoleContract(storage.paths.repositoryRoot, source.roleId);
    assertRoleContractBinding(sourceContract, source);
    const plan = createAssignmentMentionRoutePlan({
      projectId: storage.manifest.projectId,
      workstreamId: workstream.workstreamId,
      assignment,
      agents,
      sourceAllowedRoleIds: [...sourceContract.definition.profile.handoff.allowedRoleIds].sort(),
      fromAgentId: input.fromAgentId,
      leaseId: input.leaseId,
      target: input.target,
      requestDigest: input.requestDigest,
      artifactReferences: input.artifactReferences,
      contextEvidenceEventIds: input.contextEvidenceEventIds,
      observedAt: now.toISOString(),
    });
    if (input.applyPlanId === undefined) return { plan, appliedHandoffId: null };
    if (plan.planId !== input.applyPlanId) {
      throw new Error("The assignment mention route plan is stale.");
    }
    if (plan.status !== "ready" || plan.recipientAgentId === null) {
      throw new Error(`The assignment mention route is blocked: ${plan.blockedReason}.`);
    }
    const updated = await recordAssignmentHandoff({
      repositoryRoot: storage.paths.repositoryRoot,
      assignmentId: plan.assignmentId,
      fromAgentId: plan.fromAgentId,
      toAgentId: plan.recipientAgentId,
      leaseId: plan.leaseId,
      requestDigest: plan.requestDigest,
      artifactReferences: plan.artifactReferences,
      contextEvidenceEventIds: plan.contextEvidenceEventIds,
      now,
      recordEvent: (event) => recordWorkforceEvent(storage, event),
    });
    return { plan, appliedHandoffId: updated.handoffs.at(-1)?.handoffId ?? null };
  } finally {
    await storage.close();
  }
}
