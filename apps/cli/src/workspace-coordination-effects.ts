// The real effects of `lervo workspace start`'s coordination stage: the registered repository's
// writer and workforce, its Node's coordination mode, and the new worktree's Git host.
import {
  CONVERSATION_LEASE_MS,
  CONVERSATION_TASK_TYPE,
  claimAssignment,
  createAssignment,
  listAgents,
  recordConversationWorkspaceGeneration,
} from "@lervo/agent-workforce";
import { loadProjectManifest } from "@lervo/project";
import { openProjectStorage, repositoryCoordinateDigest } from "@lervo/project-storage";
import type { WorkspaceOwnershipMarker } from "@lervo/workspace-host";
import { GitWorkspaceHostAdapter } from "@lervo/workspace-host-git";

import { resolveAutomaticVerificationSuite } from "./automatic-verification-suite.js";
import { CommandFailure, errorCode } from "./command-error-output.js";
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

/**
 * Everything the stage writes rests on facts read first: the marker the start wrote, the active
 * lead, a clean checkout at its post-replay head, the target, and the suite. A failure among them
 * writes nothing. After that the assignment, its claim, and the record follow in that order; a
 * failure between them leaves at most a path-less assignment whose lease lapses within 10
 * minutes, which holds no path.
 */
async function establish(
  request: WorkspaceCoordinationRequest,
  marker: WorkspaceOwnershipMarker | null,
): Promise<void> {
  if (marker === null)
    throw new CommandFailure("coordination_marker_absent", "The start wrote no workspace marker.");
  const { repositoryRoot, workspacePath } = request;
  const lead = (await listAgents(repositoryRoot)).find(
    (agent) => agent.agentId === request.leadAgentId,
  );
  if (lead === undefined || lead.status !== "active")
    throw new CommandFailure("coordination_lead_inactive", "The conversation's lead is inactive.");
  const baseCommit = await runGit(workspacePath, ["rev-parse", "--verify", "HEAD^{commit}"]);
  const host = new GitWorkspaceHostAdapter();
  const inspected = await host.inspect({ repositoryRoot, workspacePath, baseCommit, marker });
  if (inspected.status !== "present" || !inspected.markerMatched || inspected.clean !== true)
    throw new CommandFailure(
      "coordination_checkout_unproven",
      "The new worktree is not a clean checkout bound to its marker.",
    );
  const [targetDigest, suites] = await Promise.all([
    integrationTargetDigest(repositoryRoot),
    conversationSuites(repositoryRoot),
  ]);
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
      verificationSuiteIds: suites,
      now,
      recordEvent,
    });
    const claimed = await claimAssignment({
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
      baseCommit,
      integrationTargetDigest: targetDigest,
      creationPlanId: marker.creationPlanId,
      markerHash: terminalWorkspaceDigest(marker),
      pathDigest: marker.pathDigest,
      ownerWorkspacePath: workspacePath,
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
    writerSchemaVersion,
    hubCoordinated: repositoryHubCoordinated,
    establish: (request) => establish(request, provisionedMarker()),
  };
}
