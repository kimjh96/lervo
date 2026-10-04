import {
  listAssignments,
  listWorkspaces,
  isWorkspaceCleanupJournal,
  type WorkspaceCleanupJournal,
} from "@lervo/agent-workforce";
import {
  RepositoryCoordinationRecords,
  repositoryCoordinateDigest,
  type ProjectStorage,
} from "@lervo/project-storage";
import {
  planWorkspaceCleanup,
  applyWorkspaceCleanup,
  recoverWorkspaceCleanup,
} from "@lervo/orchestrator";
import { GitWorkspaceHostAdapter } from "@lervo/workspace-host-git";
import { stableId } from "@lervo/repository-knowledge";
import { resolve, relative } from "node:path";
import { assertConvergenceDelegation, loadConvergenceDelegation } from "./delegation.js";

/** Exact non-force cleanup covers only private, canonically terminal convergence workspaces. */
export async function compactConvergenceWorkspaces(
  storage: ProjectStorage,
  provider: "codex" | "claude",
): Promise<void> {
  if ((storage.writableEventSchemaVersion ?? 1) < 4) return;
  const root = storage.paths.repositoryRoot;
  const loaded = await loadConvergenceDelegation(root);
  if (
    !loaded ||
    loaded.delegation.state !== "active" ||
    Date.parse(loaded.delegation.expiresAt) <= Date.now() ||
    !loaded.delegation.providers.includes(provider)
  )
    return;
  const validate = () =>
    assertConvergenceDelegation({
      repositoryRoot: root,
      projectId: storage.manifest.projectId,
      expectedHash: loaded.contentHash,
      provider,
    });
  await validate();
  const assignments = await listAssignments(root);
  const journals = (
    await (
      await RepositoryCoordinationRecords.open(root)
    ).list<WorkspaceCleanupJournal>("cleanupJournals")
  )
    .map((record) => record.value)
    .filter(isWorkspaceCleanupJournal);
  const ownedRoot = resolve(root, ".lervo/state/knowledge/convergence-workspaces");
  const host = new GitWorkspaceHostAdapter();
  let count = 0;
  for (const workspace of await listWorkspaces(root)) {
    if (count >= 8) break;
    const assignment = assignments.find((item) => item.assignmentId === workspace.assignmentId);
    const provenance = assignment?.convergence;
    const path = workspace.ownerWorkspacePath;
    if (
      !provenance ||
      provenance.delegationHash !== loaded.contentHash ||
      !path ||
      workspace.host.kind !== "git" ||
      workspace.host.version !== host.version ||
      workspace.integrationTargetDigest !==
        repositoryCoordinateDigest(loaded.delegation.integrationTarget.ref) ||
      relative(ownedRoot, path).startsWith("..") ||
      path === ownedRoot
    )
      continue;
    const terminal = storage.events.get(stableId("evt", [provenance.obligationId, "terminal"], 32));
    if (
      terminal?.type !== "repository.knowledge.convergence.recorded" ||
      terminal.payload.obligationId !== provenance.obligationId ||
      assignment!.lease !== null
    )
      continue;
    const coordinates = {
      repositoryRoot: root,
      workspacePath: path,
      integrationTargetRef: loaded.delegation.integrationTarget.ref,
    };
    const journal = journals.find(
      (item) =>
        item.workspaceId === workspace.workspaceId && item.generation === workspace.generation,
    );
    if (journal && ["removing", "cleanup_eligible", "removed"].includes(workspace.state)) {
      await validate();
      await recoverWorkspaceCleanup({ coordinates, journalId: journal.journalId, host });
      count++;
    } else if (["integrated", "cleanup_eligible"].includes(workspace.state)) {
      const plan = await planWorkspaceCleanup({
        coordinates,
        workspaceId: workspace.workspaceId,
        host,
      });
      if (plan.status !== "ready") continue;
      await validate();
      await applyWorkspaceCleanup({ plan, coordinates, host });
      count++;
    }
  }
}
