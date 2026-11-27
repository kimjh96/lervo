// ADR-0561 Lervo debt for a knowledge convergence stage that a conversation has held for more than
// a day (Lervo ADE coordination, "Conflicts"). It is Lervo's own wait, shown with its age and the
// holder's conversation; the stage resumes by itself, and nothing waits for the owner. Behind the
// coordination gate, and read-only: it reads existing workforce, workspace, and event state only.
import type { KnowledgeConvergenceContinuityAttentionItemV1 } from "@lervo/application-contract";
import {
  conversationLeaseHolderWorkspaceIds,
  listAssignments,
  listWorkspaces,
  readAssignmentClaimRefusals,
  type WorkforceAssignment,
} from "@lervo/agent-workforce";
import {
  inspectRepositoryCoordinationHome,
  openReadOnlyProjectStorage,
} from "@lervo/project-storage";
import {
  replayKnowledgeConvergence,
  type KnowledgeConvergenceProjection,
} from "@lervo/repository-knowledge";

import { coordinationGateOpen } from "./coordination-gate.js";

/** How long a held stage waits before its wait is Lervo debt. */
export const CONVERGENCE_STAGE_HELD_DEBT_MS = 24 * 60 * 60_000;
/** The most held stages one report names. */
const MAXIMUM_ITEMS = 8;

/** When each held stage's hold began, keyed by `holdKey`. */
type ConvergenceHoldStarts = ReadonlyMap<string, string>;

function holdKey(obligationId: string, stage: string): string {
  return `${obligationId}\0${stage}`;
}

/**
 * When each open obligation's stage began waiting on a refused claim: the settled time of its
 * latest stage record when that record is `waiting_authority` for `assignment_path_conflict`. An
 * obligation that has an outcome, superseded or archived, holds nothing.
 */
function convergenceHoldStarts(
  rows: readonly KnowledgeConvergenceProjection[],
): ConvergenceHoldStarts {
  const starts = new Map<string, string>();
  for (const row of rows) {
    const latest = row.latest?.payload;
    if (
      row.outcome !== null ||
      latest === undefined ||
      latest.state !== "waiting_authority" ||
      latest.failureCode !== "assignment_path_conflict"
    )
      continue;
    starts.set(holdKey(row.baseline.payload.obligationId, latest.stage), latest.occurredAt);
  }
  return starts;
}

/** The hold starts the repository's canonical convergence events record. */
async function readConvergenceHoldStarts(repositoryRoot: string): Promise<ConvergenceHoldStarts> {
  const storage = await openReadOnlyProjectStorage(repositoryRoot);
  try {
    return convergenceHoldStarts(replayKnowledgeConvergence(storage.events));
  } finally {
    await storage.close();
  }
}

/** A convergence writer whose claim could not be made yet: unfinished and unleased. */
function waitingStage(assignment: WorkforceAssignment, now: Date): boolean {
  return (
    assignment.convergence != null &&
    assignment.accessMode !== "read_only" &&
    assignment.status === "queued" &&
    // Its hold began after it was created, so a younger one cannot have waited a day.
    now.getTime() - Date.parse(assignment.createdAt) > CONVERGENCE_STAGE_HELD_DEBT_MS
  );
}

/** When the stage's current hold began, if it has waited more than a day; otherwise null. */
function heldSince(
  assignment: WorkforceAssignment,
  starts: ConvergenceHoldStarts,
  now: Date,
): string | null {
  const convergence = assignment.convergence;
  if (convergence == null) return null;
  const since = starts.get(holdKey(convergence.obligationId, convergence.stage));
  return since !== undefined && now.getTime() - Date.parse(since) > CONVERGENCE_STAGE_HELD_DEBT_MS
    ? since
    : null;
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
  since: string,
  now: Date,
): KnowledgeConvergenceContinuityAttentionItemV1 {
  const hours = Math.floor((now.getTime() - Date.parse(since)) / 3_600_000);
  const stage = assignment.convergence?.stage ?? "unknown";
  return {
    schemaVersion: 1,
    kind: "knowledge_convergence_continuity",
    itemId: `knowledge_convergence_continuity_convergence_stage_held_${assignment.assignmentId}`,
    state: "lervo_debt",
    findingCode: "convergence_stage_held",
    severity: "lervo_debt",
    detail: conversationId,
    observedAt: since,
    actionOwner: "host resident",
    requiresUserAction: false,
    blocking: false,
    instruction: `Lervo debt: knowledge convergence stage ${stage} has waited ${hours} hours for paths that conversation ${conversationId} holds. It resumes by itself once that conversation's change is sealed and integrated, or its claims lapse; nothing waits for the owner.`,
  };
}

/**
 * One Lervo debt item per knowledge convergence stage held by a conversation for more than a
 * day, counted from when its refused claim settled. A closed gate, or a repository without a
 * coordination home, reads nothing else; the events are read only when a writer has waited.
 */
export async function readConvergenceStageHoldDebt(
  repositoryRoot: string,
  now: Date = new Date(),
  environment: NodeJS.ProcessEnv = process.env,
): Promise<KnowledgeConvergenceContinuityAttentionItemV1[]> {
  if (!(await coordinationGateOpen(repositoryRoot, environment))) return [];
  if ((await inspectRepositoryCoordinationHome(repositoryRoot)) === null) return [];
  const assignments = await listAssignments(repositoryRoot, { readOnly: true });
  const candidates = assignments.filter((assignment) => waitingStage(assignment, now));
  if (candidates.length === 0) return [];
  const starts = await readConvergenceHoldStarts(repositoryRoot);
  const waiting = candidates.flatMap((assignment) => {
    const since = heldSince(assignment, starts, now);
    return since === null ? [] : [{ assignment, since }];
  });
  if (waiting.length === 0) return [];
  const leaseOwners = conversationLeaseHolderWorkspaceIds(await listWorkspaces(repositoryRoot));
  const items: KnowledgeConvergenceContinuityAttentionItemV1[] = [];
  for (const { assignment, since } of waiting.slice(0, MAXIMUM_ITEMS)) {
    const conversation = await holderConversation(
      repositoryRoot,
      assignment,
      assignments,
      leaseOwners,
      now,
    );
    if (conversation !== null) items.push(item(assignment, conversation, since, now));
  }
  return items;
}
