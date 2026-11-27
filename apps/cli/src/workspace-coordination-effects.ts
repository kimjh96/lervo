// The real effects of `lervo workspace start`'s coordination stage: the registered repository's
// writer and workforce, its Node's coordination mode, and the new worktree's Git host.
import { realpath } from "node:fs/promises";

import {
  CONVERSATION_LEASE_MS,
  CONVERSATION_TASK_TYPE,
  cancelAssignment,
  claimAssignment,
  createAssignment,
  createAssignmentCancellationPlan,
  listAgents,
  listAssignments,
  recordConversationWorkspaceGeneration,
} from "@lervo/agent-workforce";
import { loadProjectManifest } from "@lervo/project";
import { openProjectStorage, repositoryCoordinateDigest } from "@lervo/project-storage";
import type { WorkspaceOwnershipMarker } from "@lervo/workspace-host";
import { GitWorkspaceHostAdapter } from "@lervo/workspace-host-git";

import { resolveAutomaticVerificationSuite } from "./automatic-verification-suite.js";
import { CommandFailure, errorCode } from "./command-error-output.js";
import { coordinationGateOpen } from "./coordination-gate.js";
import {
  observeAbsentRepositoryNode,
  resolveDistributedReaderInventorySource,
} from "./event-reader-inventory-source.js";
import { providerSessionDigest } from "./hosted-session-events.js";
import {
  terminalWorkspaceDigest,
  terminalWriterSessionIdForDigest,
} from "./terminal-workspace-boundary.js";
import { recordWorkforceEvent } from "./workforce-events.js";
import { defaultBranchOf } from "./workspace-base.js";
import { runGit } from "./workspace-base-git.js";
import type {
  WorkspaceCoordinationPorts,
  WorkspaceCoordinationRequest,
} from "./workspace-coordination.js";

const ACCEPTANCE_CRITERION = "The conversation's sealed change passes its verification.";
const CONVERSATION_PRIORITY = 50;

async function writerSchemaVersion(repositoryRoot: string): Promise<number> {
  const storage = await openProjectStorage(repositoryRoot);
  try {
    return storage.writableEventSchemaVersion ?? 1;
  } finally {
    await storage.close();
  }
}

/**
 * Whether a Node of this host reserves the repository's paths at the Hub (ADR-0222's
 * `hub_coordinated`). Only a Node reserves, so a repository without Hub sync or without a Node
 * here is local-first; a Node whose configuration cannot be read fails the stage instead.
 */
async function repositoryHubCoordinated(repositoryRoot: string): Promise<boolean> {
  const manifest = await loadProjectManifest(repositoryRoot);
  if (!manifest.dataPolicy.hubSyncEnabled) return false;
  if ((await observeAbsentRepositoryNode({ repositoryRoot })) !== null) return false;
  const source = await resolveDistributedReaderInventorySource({ repositoryRoot });
  return source.nodeConfig.workspaceCoordination !== undefined;
}

/** The project's automatic suite, or none when the project configures none. */
async function conversationSuites(repositoryRoot: string): Promise<string[]> {
  try {
    return [await resolveAutomaticVerificationSuite(repositoryRoot)];
  } catch (error) {
    if (errorCode(error) === "deliberation_verification_unconfigured") return [];
    throw error;
  }
}

/**
 * Generation 1's integration target. Batch branches arrive with the integration command
 * (Lervo ADE coordination, slice 3), which makes an open batch the target; until then it is the
 * default branch.
 */
async function integrationTargetDigest(repositoryRoot: string): Promise<string> {
  const target = await defaultBranchOf(repositoryRoot);
  return repositoryCoordinateDigest(`refs/heads/${target.branch}`);
}

/** What the stage reads before it writes anything. */
interface ConversationFacts {
  readonly lead: Awaited<ReturnType<typeof listAgents>>[number];
  readonly marker: WorkspaceOwnershipMarker;
  readonly host: GitWorkspaceHostAdapter;
  readonly baseCommit: string;
  /** The worktree's real path, whose digest the marker and every checkout reader use. */
  readonly checkoutPath: string;
  readonly targetDigest: string;
  readonly suites: string[];
}

/**
 * The facts the stage's writes rest on: the marker the start wrote, the active lead, and a clean
 * checkout bound to that marker at its post-replay head, plus the target and the suite. A failure
 * here writes nothing.
 */
async function readFacts(
  request: WorkspaceCoordinationRequest,
  marker: WorkspaceOwnershipMarker | null,
): Promise<ConversationFacts> {
  if (marker === null)
    throw new CommandFailure("coordination_marker_absent", "The start wrote no workspace marker.");
  const { repositoryRoot, workspacePath } = request;
  const lead = (await listAgents(repositoryRoot)).find(
    (agent) => agent.agentId === request.leadAgentId,
  );
  if (lead === undefined || lead.status !== "active")
    throw new CommandFailure("coordination_lead_inactive", "The conversation's lead is inactive.");
  const checkoutPath = await realpath(workspacePath);
  const baseCommit = await runGit(workspacePath, ["rev-parse", "--verify", "HEAD^{commit}"]);
  const host = new GitWorkspaceHostAdapter();
  const inspected = await host.inspect({ repositoryRoot, workspacePath, baseCommit, marker });
  if (
    inspected.status !== "present" ||
    !inspected.markerMatched ||
    inspected.clean !== true ||
    marker.pathDigest !== repositoryCoordinateDigest(checkoutPath) ||
    marker.adapterKind !== host.kind ||
    marker.adapterVersion !== host.version
  )
    throw new CommandFailure(
      "coordination_checkout_unproven",
      "The new worktree is not a clean checkout bound to its marker.",
    );
  const [targetDigest, suites] = await Promise.all([
    integrationTargetDigest(repositoryRoot),
    conversationSuites(repositoryRoot),
  ]);
  return { lead, marker, host, baseCommit, checkoutPath, targetDigest, suites };
}

/**
 * Claims the new assignment for the lead. When the claim fails, the still-queued assignment is
 * cancelled (`requested`), so a failed stage leaves no assignment that waits for a claimant; a
 * cancellation that fails too is reported as `coordination_assignment_stranded`.
 */
async function claimOrWithdraw(
  input: Parameters<typeof claimAssignment>[0],
): Promise<Awaited<ReturnType<typeof claimAssignment>>> {
  try {
    return await claimAssignment(input);
  } catch (claimError) {
    try {
      const plan = createAssignmentCancellationPlan({
        assignments: await listAssignments(input.repositoryRoot),
        assignmentId: input.assignmentId,
        reason: "requested",
      });
      await cancelAssignment({
        repositoryRoot: input.repositoryRoot,
        assignmentId: input.assignmentId,
        reason: "requested",
        expectedPlanId: plan.planId,
        ...(input.recordEvent === undefined ? {} : { recordEvent: input.recordEvent }),
      });
    } catch (cancelError) {
      throw new CommandFailure(
        "coordination_assignment_stranded",
        "The lead's claim failed and the conversation assignment could not be cancelled.",
        {
          assignmentId: input.assignmentId,
          claimCause: errorCode(claimError),
          cancelCause: errorCode(cancelError),
        },
      );
    }
    throw claimError;
  }
}

/**
 * Creates the conversation assignment, claims it for the lead, and records generation 1, in that
 * order. A failed claim cancels the assignment. A failed record leaves the claimed assignment,
 * which holds no path and whose lease lapses within 10 minutes; nothing then refers to it.
 */
async function establish(
  request: WorkspaceCoordinationRequest,
  provisionedMarker: WorkspaceOwnershipMarker | null,
): Promise<void> {
  const facts = await readFacts(request, provisionedMarker);
  const { repositoryRoot } = request;
  const { lead, marker, host } = facts;
  const storage = await openProjectStorage(repositoryRoot);
  try {
    const recordEvent = (event: Parameters<typeof recordWorkforceEvent>[1]) =>
      recordWorkforceEvent(storage, event);
    const now = new Date();
    const assignment = await createAssignment({
      repositoryRoot,
      taskType: CONVERSATION_TASK_TYPE,
      roleId: lead.roleId,
      expectedRoleVersion: lead.roleVersion,
      expectedRoleContractHash: lead.roleContractHash,
      expectedPaths: [],
      workstreamId: request.workstreamId,
      priority: CONVERSATION_PRIORITY,
      acceptanceCriteria: [ACCEPTANCE_CRITERION],
      verificationSuiteIds: facts.suites,
      now,
      recordEvent,
    });
    const claimed = await claimOrWithdraw({
      repositoryRoot,
      assignmentId: assignment.assignmentId,
      expectedRevision: assignment.revision,
      agentId: lead.agentId,
      sessionId: terminalWriterSessionIdForDigest(
        providerSessionDigest(request.provider, request.sessionId),
      ),
      leaseDurationMs: CONVERSATION_LEASE_MS,
      now,
      recordEvent,
    });
    await recordConversationWorkspaceGeneration({
      repositoryRoot,
      conversationId: request.conversationId,
      generation: marker.generation,
      repositoryInstanceId: marker.repositoryInstanceId,
      projectId: storage.manifest.projectId,
      assignmentId: claimed.assignmentId,
      agentId: lead.agentId,
      leaseGeneration: claimed.lease!.generation,
      host: { kind: host.kind, version: host.version, nativeInstanceDigest: null },
      baseCommit: facts.baseCommit,
      integrationTargetDigest: facts.targetDigest,
      creationPlanId: marker.creationPlanId,
      markerHash: terminalWorkspaceDigest(marker),
      pathDigest: marker.pathDigest,
      ownerWorkspacePath: facts.checkoutPath,
      inspection: { hostInspected: true, markerMatched: true, checkoutClean: true },
      now: new Date(),
    });
  } finally {
    await storage.close();
  }
}

/** The coordination stage's ports, bound to the marker the workspace stage wrote. */
export function conversationCoordinationPorts(
  provisionedMarker: () => WorkspaceOwnershipMarker | null,
): WorkspaceCoordinationPorts {
  return {
    stageEnabled: (repositoryRoot) => coordinationGateOpen(repositoryRoot, process.env),
    writerSchemaVersion,
    hubCoordinated: repositoryHubCoordinated,
    establish: (request) => establish(request, provisionedMarker()),
  };
}
