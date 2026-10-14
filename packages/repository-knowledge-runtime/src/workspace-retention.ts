import {
  listAssignments,
  listWorkspaces,
  isWorkspaceCleanupJournal,
  readWorkspace,
  updateWorkspace,
  type AgentWorkspace,
  type WorkforceAssignment,
  type WorkspaceCleanupJournal,
} from "@lervo/agent-workforce";
import {
  RepositoryCoordinationRecords,
  repositoryCoordinateDigest,
  type ProjectStorage,
} from "@lervo/project-storage";
import { recoverWorkspaceCleanup } from "@lervo/orchestrator";
import { GitWorkspaceHostAdapter } from "@lervo/workspace-host-git";
import { stableId } from "@lervo/repository-knowledge";
import { resolve } from "node:path";
import { CONVERGENCE_ASSIGNMENT_ATTEMPT_LIMIT } from "./assignment-failure.js";
import { loadConvergenceDelegation } from "./delegation.js";

const RETIREMENT = "convergence_retirement";
const MAXIMUM_RETIREMENTS_PER_CYCLE = 8;
/** Git adapter codes that prove the checkout was left unchanged. */
const HOST_REFUSALS = new Set(["host_marker_mismatch", "host_operation_in_progress"]);

/** Why no later convergence effect can read this checkout again. */
export type ConvergenceWorkspaceRetirementReason =
  "obligation_settled" | "assignment_closed" | "lease_superseded";

/**
 * ADR-0518: a convergence checkout is retired once its obligation recorded a terminal outcome, its
 * assignment can never be reopened, or a later lease generation replaced it before it sealed. Every
 * byte in it is Lervo-generated, and the drafts and verification results are retained in CAS, so
 * neither target reachability nor the current delegation is needed.
 */
export function convergenceWorkspaceRetirement(input: {
  workspace: AgentWorkspace;
  assignment: WorkforceAssignment | undefined;
  obligationSettled: boolean;
  ownedRoot: string;
}): ConvergenceWorkspaceRetirementReason | null {
  const { workspace, assignment } = input;
  if (
    !assignment?.convergence ||
    workspace.state === "removed" ||
    workspace.state === "removing" ||
    workspace.host.kind !== "git" ||
    workspace.ownerWorkspacePath !==
      resolve(
        input.ownedRoot,
        assignment.assignmentId,
        `lease-${workspace.leaseGeneration}`,
        workspace.executionKind,
      )
  )
    return null;
  if (assignment.lease === null && input.obligationSettled) return "obligation_settled";
  if (
    assignment.lease === null &&
    (assignment.status === "cancelled" ||
      (assignment.status === "failed" &&
        (assignment.recovery?.attemptNumber ?? 1) >= CONVERGENCE_ASSIGNMENT_ATTEMPT_LIMIT))
  )
    return "assignment_closed";
  const generation = assignment.lease?.generation ?? assignment.lastLeaseGeneration ?? 0;
  if (workspace.sealedResult === null && generation > workspace.leaseGeneration)
    return "lease_superseded";
  return null;
}

function obligationSettled(storage: ProjectStorage, obligationId: string): boolean {
  const terminal = storage.events.get(stableId("evt", [obligationId, "terminal"], 32));
  return (
    terminal?.type === "repository.knowledge.convergence.recorded" &&
    terminal.payload.obligationId === obligationId
  );
}

/**
 * Fences the record out of use, removes the checkout, then records `removed`. A rerun resumes an
 * interrupted retirement. Uncommitted bytes, such as a lockfile a verification rewrote, are
 * discarded: a seal binds only committed bytes, and nothing but Lervo writes in this private root.
 */
async function retireConvergenceWorkspace(
  root: string,
  workspace: AgentWorkspace,
  reason: ConvergenceWorkspaceRetirementReason,
): Promise<void> {
  let stored = await readWorkspace(root, workspace.workspaceId);
  if (stored === null || stored.workspace.revision !== workspace.revision) return;
  const eventId = (step: string) =>
    stableId("evt", [workspace.workspaceId, workspace.generation, RETIREMENT, step], 32);
  if (
    stored.workspace.state !== "recovery_required" ||
    stored.workspace.recoveryReason !== RETIREMENT
  )
    stored = await updateWorkspace({
      repositoryRoot: root,
      workspaceId: workspace.workspaceId,
      expectedContentHash: stored.contentHash,
      expectedRevision: stored.workspace.revision,
      expectedGeneration: stored.workspace.generation,
      nextState: "recovery_required",
      occurredAt: new Date().toISOString(),
      writerSession: null,
      recoveryReason: RETIREMENT,
      reasonCode: reason,
      eventId: eventId("fenced"),
    });
  const current = stored.workspace;
  const host = new GitWorkspaceHostAdapter();
  const request = {
    repositoryRoot: root,
    workspacePath: current.ownerWorkspacePath!,
    baseCommit: current.baseCommit,
    marker: {
      schemaVersion: 1 as const,
      workspaceId: current.workspaceId,
      generation: current.generation,
      repositoryInstanceId: current.repositoryInstanceId,
      adapterKind: current.host.kind,
      adapterVersion: current.host.version,
      creationPlanId: current.creationPlanId,
      pathDigest: current.pathDigest,
    },
    idempotencyKey: `idk_${eventId("removal").slice(4)}`,
  };
  const after = await host.removeDiscardingChanges(request);
  if (after.status !== "absent") return;
  await updateWorkspace({
    repositoryRoot: root,
    workspaceId: current.workspaceId,
    expectedContentHash: stored.contentHash,
    expectedRevision: current.revision,
    expectedGeneration: current.generation,
    nextState: "removed",
    occurredAt: new Date().toISOString(),
    evidence: { hostAbsent: true, gitMetadataAbsent: true },
    reasonCode: reason,
    eventId: eventId("removed"),
  });
}

type RetentionItem =
  | { kind: "journal"; workspace: AgentWorkspace; journalId: string; integrationTargetRef: string }
  | { kind: "retire"; workspace: AgentWorkspace; reason: ConvergenceWorkspaceRetirementReason };

async function retentionItems(storage: ProjectStorage): Promise<RetentionItem[]> {
  if ((storage.writableEventSchemaVersion ?? 1) < 4) return [];
  const root = storage.paths.repositoryRoot;
  const ownedRoot = resolve(root, ".lervo/state/knowledge/convergence-workspaces");
  const assignments = new Map(
    (await listAssignments(root)).map((item) => [item.assignmentId, item]),
  );
  const journals = (
    await (
      await RepositoryCoordinationRecords.open(root)
    ).list<WorkspaceCleanupJournal>("cleanupJournals")
  )
    .map((record) => record.value)
    .filter(isWorkspaceCleanupJournal);
  const ref = (await loadConvergenceDelegation(root).catch(() => null))?.delegation
    .integrationTarget.ref;
  const items: RetentionItem[] = [];
  for (const workspace of await listWorkspaces(root)) {
    const journal = journals.find(
      (item) =>
        item.workspaceId === workspace.workspaceId && item.generation === workspace.generation,
    );
    // A cleanup journaled by an earlier release finishes through its own exact recovery.
    if (journal && ["removing", "cleanup_eligible"].includes(workspace.state)) {
      if (
        ref !== undefined &&
        workspace.ownerWorkspacePath !== undefined &&
        workspace.integrationTargetDigest === repositoryCoordinateDigest(ref)
      )
        items.push({
          kind: "journal",
          workspace,
          journalId: journal.journalId,
          integrationTargetRef: ref,
        });
      continue;
    }
    const assignment = assignments.get(workspace.assignmentId);
    const reason = convergenceWorkspaceRetirement({
      workspace,
      assignment,
      obligationSettled:
        assignment?.convergence != null &&
        obligationSettled(storage, assignment.convergence.obligationId),
      ownedRoot,
    });
    if (reason !== null) items.push({ kind: "retire", workspace, reason });
  }
  return items;
}

/** Whether this host holds a convergence checkout that retention would remove now. */
export async function hasConvergenceWorkspaceRetention(storage: ProjectStorage): Promise<boolean> {
  return (await retentionItems(storage)).length > 0;
}

/**
 * Host-local retention for this repository's convergence checkouts. Records and checkouts are
 * private to this host, so every host runs it, whether or not it owns convergence.
 */
export async function compactConvergenceWorkspaces(storage: ProjectStorage): Promise<number> {
  const root = storage.paths.repositoryRoot;
  let count = 0;
  for (const item of await retentionItems(storage)) {
    if (count >= MAXIMUM_RETIREMENTS_PER_CYCLE) break;
    if (item.kind === "journal") {
      await recoverWorkspaceCleanup({
        coordinates: {
          repositoryRoot: root,
          workspacePath: item.workspace.ownerWorkspacePath!,
          integrationTargetRef: item.integrationTargetRef,
        },
        journalId: item.journalId,
        host: new GitWorkspaceHostAdapter(),
      });
      count++;
      continue;
    }
    try {
      await retireConvergenceWorkspace(root, item.workspace, item.reason);
      count++;
    } catch (error) {
      // A host refusal leaves the record fenced as `recovery_required`; a later cycle retries it.
      if (!HOST_REFUSALS.has((error as { code?: unknown } | null)?.code as string)) throw error;
    }
  }
  return count;
}
