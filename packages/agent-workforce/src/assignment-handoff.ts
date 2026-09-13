import {
  type WorkforceArtifactReference,
  type WorkforceHandoffTriggerProvenance,
  type WorkforceEventRecorder,
  type WorkforceAssignment,
  type WorkforceHandoff,
} from "./types.js";
import {
  AGENT_ID,
  HASH,
  validArtifact,
  boundedStrings,
  EVENT_ID,
  validHandoffTrigger,
  fail,
  stableJson,
  id,
  ASSIGNMENT_ID,
  HANDOFF_ID,
} from "./workforce-state-validation.js";
import { listAgents } from "./agent-registry.js";
import { resolveRoleContract, assertRoleContractBinding } from "@lervo/roles";
import { readAssignmentState, assignmentPath } from "./assignment-state.js";
import { exactLease } from "./assignment-lease.js";
import { randomUUID } from "node:crypto";
import { transition, retryConcurrent } from "./workforce-state-io.js";

export async function recordAssignmentHandoffOnce(input: {
  repositoryRoot: string;
  assignmentId: string;
  fromAgentId: string;
  toAgentId: string;
  leaseId: string;
  requestDigest: string;
  artifactReferences: WorkforceArtifactReference[];
  contextEvidenceEventIds: string[];
  trigger?: WorkforceHandoffTriggerProvenance;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAssignment> {
  const now = input.now ?? new Date();
  if (
    !AGENT_ID.test(input.fromAgentId) ||
    !AGENT_ID.test(input.toAgentId) ||
    input.fromAgentId === input.toAgentId ||
    !HASH.test(input.requestDigest) ||
    !Array.isArray(input.artifactReferences) ||
    !input.artifactReferences.every(validArtifact) ||
    !boundedStrings(input.contextEvidenceEventIds, 64, EVENT_ID) ||
    (input.trigger !== undefined && !validHandoffTrigger(input.trigger))
  )
    fail("assignment_invalid", "The handoff coordinates are invalid.");
  const agents = await listAgents(input.repositoryRoot);
  const from = agents.find((agent) => agent.agentId === input.fromAgentId);
  const to = agents.find((agent) => agent.agentId === input.toAgentId);
  if (from === undefined || to === undefined || from.status !== "active" || to.status !== "active")
    fail("agent_state_conflict", "A handoff requires two active agents.");
  const fromContract = await resolveRoleContract(input.repositoryRoot, from.roleId);
  const toContract = await resolveRoleContract(input.repositoryRoot, to.roleId);
  try {
    assertRoleContractBinding(fromContract, from);
    assertRoleContractBinding(toContract, to);
  } catch (error) {
    fail("agent_state_conflict", "A handoff agent role contract is stale.", error);
  }
  if (!fromContract.definition.profile.handoff.allowedRoleIds.includes(to.roleId))
    fail("agent_state_conflict", "The source role does not allow this recipient role.");
  const assignmentState = await readAssignmentState(input.repositoryRoot, input.assignmentId);
  const assignment = assignmentState.value;
  exactLease(assignment, input.fromAgentId, input.leaseId, now);
  if (input.trigger !== undefined) {
    const sameSource = assignment.handoffs.filter(
      (item) =>
        item.trigger?.adapterId === input.trigger!.adapterId &&
        item.trigger.sourceEventKeyHash === input.trigger!.sourceEventKeyHash,
    );
    const exact = sameSource.find(
      (item) =>
        item.fromAgentId === input.fromAgentId &&
        item.toAgentId === input.toAgentId &&
        item.requestDigest === input.requestDigest &&
        stableJson(item.artifactReferences) === stableJson(input.artifactReferences) &&
        stableJson(item.contextEvidenceEventIds) === stableJson(input.contextEvidenceEventIds) &&
        stableJson(item.trigger) === stableJson(input.trigger),
    );
    if (sameSource.length > 1 || (sameSource.length === 1 && exact === undefined)) {
      fail("assignment_invalid", "The message trigger source event conflicts with a handoff.");
    }
    if (exact !== undefined) return structuredClone(assignment);
  }
  const createdAt = now.toISOString();
  const handoff: WorkforceHandoff = {
    handoffId: id("hnd", { assignmentId: assignment.assignmentId, nonce: randomUUID() }),
    fromAgentId: from.agentId,
    toAgentId: to.agentId,
    requestDigest: input.requestDigest,
    artifactReferences: [...input.artifactReferences],
    contextEvidenceEventIds: [...input.contextEvidenceEventIds],
    createdAt,
    acknowledgedAt: null,
    trigger: input.trigger ?? null,
  };
  const next = {
    ...assignment,
    handoffs: [...assignment.handoffs, handoff],
    revision: assignment.revision + 1,
    updatedAt: createdAt,
  };
  const target = await assignmentPath(input.repositoryRoot, assignment.assignmentId);
  return transition({
    path: target.path,
    lockPath: target.lockPath,
    now,
    content: `${JSON.stringify(next, null, 2)}\n`,
    result: structuredClone(next),
    ...(input.recordEvent === undefined ? {} : { recordEvent: input.recordEvent }),
    expectedBefore: assignmentState.source,
    event: {
      type: "assignment.handoff.recorded",
      occurredAt: createdAt,
      actorAgentId: from.agentId,
      payload: {
        assignmentId: assignment.assignmentId,
        handoffId: handoff.handoffId,
        fromAgentId: from.agentId,
        toAgentId: to.agentId,
        requestDigest: handoff.requestDigest,
        artifactIds: handoff.artifactReferences.map((item) => item.artifactId),
        artifactHashes: handoff.artifactReferences.map((item) => item.contentHash),
        contextEvidenceEventIds: handoff.contextEvidenceEventIds,
        ...(handoff.trigger == null
          ? {}
          : {
              triggerKind: handoff.trigger.kind,
              triggerAdapterId: handoff.trigger.adapterId,
              triggerAdapterVersion: handoff.trigger.adapterVersion,
              triggerDescriptorHash: handoff.trigger.descriptorHash,
              triggerSourceEventId: handoff.trigger.sourceEventId,
              triggerSourceEventKeyHash: handoff.trigger.sourceEventKeyHash,
            }),
      },
    },
  });
}

export function recordAssignmentHandoff(input: {
  repositoryRoot: string;
  assignmentId: string;
  fromAgentId: string;
  toAgentId: string;
  leaseId: string;
  requestDigest: string;
  artifactReferences: WorkforceArtifactReference[];
  contextEvidenceEventIds: string[];
  trigger?: WorkforceHandoffTriggerProvenance;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAssignment> {
  return retryConcurrent(() => recordAssignmentHandoffOnce(input));
}

export async function acknowledgeAssignmentHandoffOnce(input: {
  repositoryRoot: string;
  assignmentId: string;
  handoffId: string;
  recipientAgentId: string;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAssignment> {
  const now = input.now ?? new Date();
  if (
    !ASSIGNMENT_ID.test(input.assignmentId) ||
    !HANDOFF_ID.test(input.handoffId) ||
    !AGENT_ID.test(input.recipientAgentId) ||
    !Number.isFinite(now.getTime())
  ) {
    fail("assignment_invalid", "The handoff acknowledgement coordinates are invalid.");
  }
  const agents = await listAgents(input.repositoryRoot);
  const recipient = agents.find((agent) => agent.agentId === input.recipientAgentId);
  if (recipient === undefined || recipient.status !== "active") {
    fail("agent_state_conflict", "A handoff acknowledgement requires its active recipient.");
  }
  try {
    assertRoleContractBinding(
      await resolveRoleContract(input.repositoryRoot, recipient.roleId),
      recipient,
    );
  } catch (error) {
    fail("agent_state_conflict", "The handoff recipient role contract is stale.", error);
  }
  const assignmentState = await readAssignmentState(input.repositoryRoot, input.assignmentId);
  const assignment = assignmentState.value;
  const index = assignment.handoffs.findIndex((item) => item.handoffId === input.handoffId);
  if (index < 0) fail("assignment_invalid", "The handoff acknowledgement target is missing.");
  const handoff = assignment.handoffs[index]!;
  if (handoff.toAgentId !== input.recipientAgentId) {
    fail("agent_state_conflict", "Only the exact handoff recipient can acknowledge it.");
  }
  if (handoff.acknowledgedAt !== null) return structuredClone(assignment);
  if (now.getTime() < Date.parse(handoff.createdAt)) {
    fail("assignment_invalid", "The handoff acknowledgement predates the route.");
  }
  const acknowledgedAt = now.toISOString();
  const handoffs = assignment.handoffs.map((item, itemIndex) =>
    itemIndex === index ? { ...item, acknowledgedAt } : item,
  );
  const next = {
    ...assignment,
    handoffs,
    revision: assignment.revision + 1,
    updatedAt: acknowledgedAt,
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
      type: "assignment.handoff.acknowledged",
      occurredAt: acknowledgedAt,
      actorAgentId: recipient.agentId,
      payload: {
        assignmentId: assignment.assignmentId,
        handoffId: handoff.handoffId,
        recipientAgentId: recipient.agentId,
        acknowledgedAt,
        assignmentRevision: next.revision,
      },
    },
  });
}

export function acknowledgeAssignmentHandoff(input: {
  repositoryRoot: string;
  assignmentId: string;
  handoffId: string;
  recipientAgentId: string;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAssignment> {
  return retryConcurrent(() => acknowledgeAssignmentHandoffOnce(input));
}
