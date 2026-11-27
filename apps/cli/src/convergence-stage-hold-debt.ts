// ADR-0561 Lervo debt for a knowledge convergence stage that a conversation has held for more than
// a day (Lervo ADE coordination, "Conflicts"). It is Lervo's own wait, shown with its age and the
// holder's conversation; the stage resumes by itself, and nothing waits for the owner. Behind the
// coordination gate, and read-only: it reads existing workforce and workspace state only.
import type { KnowledgeConvergenceContinuityAttentionItemV1 } from "@lervo/application-contract";
import {
  conversationLeaseHolderWorkspaceIds,
  listAssignments,
  listWorkspaces,
  readAssignmentClaimRefusals,
  type WorkforceAssignment,
} from "@lervo/agent-workforce";
import { inspectRepositoryCoordinationHome } from "@lervo/project-storage";

import { coordinationGateOpen } from "./coordination-gate.js";

/** How long a held stage waits before its wait is Lervo debt. */
export const CONVERGENCE_STAGE_HELD_DEBT_MS = 24 * 60 * 60_000;
/** The most held stages one report names. */
const MAXIMUM_ITEMS = 8;

/** A convergence stage whose claim could not be made yet: an unfinished, unleased writer. */
function waitingStage(assignment: WorkforceAssignment, now: Date): boolean {
  return (
    assignment.convergence != null &&
    assignment.accessMode !== "read_only" &&
    assignment.status === "queued" &&
    now.getTime() - Date.parse(assignment.createdAt) > CONVERGENCE_STAGE_HELD_DEBT_MS
  );
}

/** The conversation whose lease or change refuses the stage's claim now, or null. */
async function holderConversation(
  repositoryRoot: string,
  assignment: WorkforceAssignment,
  assignments: readonly WorkforceAssignment[],
  leaseOwners: ReadonlyMap<string, string>,
  now: Date,
): Promise<string | null> {
  const refusals = await readAssignmentClaimRefusals({
    repositoryRoot,
    assignment,
    assignments,
    now,
  });
  for (const refusal of refusals) {
    const conversation =
      refusal.holderWorkspaceId ??
      (refusal.holderAssignmentId === null
        ? undefined
        : leaseOwners.get(refusal.holderAssignmentId));
    if (conversation !== undefined && conversation !== null) return conversation;
  }
  return null;
}

function item(
  assignment: WorkforceAssignment,
  conversationId: string,
  now: Date,
): KnowledgeConvergenceContinuityAttentionItemV1 {
  const hours = Math.floor((now.getTime() - Date.parse(assignment.createdAt)) / 3_600_000);
  const stage = assignment.convergence?.stage ?? "unknown";
  return {
    schemaVersion: 1,
    kind: "knowledge_convergence_continuity",
    itemId: `knowledge_convergence_continuity_convergence_stage_held_${assignment.assignmentId}`,
    state: "lervo_debt",
    findingCode: "convergence_stage_held",
    severity: "lervo_debt",
    detail: conversationId,
    observedAt: assignment.createdAt,
    actionOwner: "host resident",
    requiresUserAction: false,
    blocking: false,
    instruction: `Lervo debt: knowledge convergence stage ${stage} has waited ${hours} hours for paths that conversation ${conversationId} holds. It resumes by itself once that conversation's change is sealed and integrated, or its claims lapse; nothing waits for the owner.`,
  };
}

/**
 * One Lervo debt item per knowledge convergence stage held by a conversation for more than a
 * day. A closed gate, or a repository without a coordination home, reads nothing else.
 */
export async function readConvergenceStageHoldDebt(
  repositoryRoot: string,
  now: Date = new Date(),
  environment: NodeJS.ProcessEnv = process.env,
): Promise<KnowledgeConvergenceContinuityAttentionItemV1[]> {
  if (!(await coordinationGateOpen(repositoryRoot, environment))) return [];
  if ((await inspectRepositoryCoordinationHome(repositoryRoot)) === null) return [];
  const assignments = await listAssignments(repositoryRoot, { readOnly: true });
  const waiting = assignments.filter((assignment) => waitingStage(assignment, now));
  if (waiting.length === 0) return [];
  const leaseOwners = conversationLeaseHolderWorkspaceIds(await listWorkspaces(repositoryRoot));
  const items: KnowledgeConvergenceContinuityAttentionItemV1[] = [];
  for (const assignment of waiting.slice(0, MAXIMUM_ITEMS)) {
    const conversation = await holderConversation(
      repositoryRoot,
      assignment,
      assignments,
      leaseOwners,
      now,
    );
    if (conversation !== null) items.push(item(assignment, conversation, now));
  }
  return items;
}
