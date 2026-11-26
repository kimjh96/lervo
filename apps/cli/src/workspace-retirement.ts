import {
  isConversationWorkspace,
  listWorkspaces,
  openRepositorySupervisionLeases,
  SupervisionMandateJournal,
} from "@lervo/agent-workforce";
import { retireUnstartedSupervisionWorkspace } from "@lervo/node-runtime";
import { openProjectStorage } from "@lervo/project-storage";
import { operatingContractHash } from "@lervo/work-controller";

/**
 * Retires never-used checkouts of one supervised workstream while holding the supervision owner
 * lease, so no owner decision can observe a half-changed workspace set.
 */
export async function retireRepositoryUnstartedWorkspaces(input: {
  root: string;
  supervisionId: string;
  workstreamId: string;
  workspaceId?: string;
}) {
  const storage = await openProjectStorage(input.root);
  let installation;
  try {
    installation = await new SupervisionMandateJournal(
      storage.events,
      storage.artifacts,
      {
        projectId: storage.manifest.projectId,
        supervisionId: input.supervisionId,
        workstreamId: input.workstreamId,
        workstreamRevision: 1,
        ownerAgentId: `agt_${"0".repeat(24)}`,
        mandateHash: operatingContractHash({ supervisionId: input.supervisionId }),
        sessionId: `ses_${operatingContractHash({ supervisionId: input.supervisionId }).slice(7, 39)}`,
        policyVersion: operatingContractHash({ contract: "operating_mandate.installation.v1" }),
      },
      () => new Date().toISOString(),
      null,
    ).current();
  } finally {
    await storage.close();
  }
  if (installation === null) throw new Error("Workspace retirement requires an installed mandate.");
  const binding = {
    supervisionId: input.supervisionId,
    workstreamId: input.workstreamId,
    ownerAgentId: installation.mandate.ownerAgentId,
    mandateHash: installation.mandateHash,
  };
  const leases = await openRepositorySupervisionLeases(input.root);
  try {
    const lease = leases.acquire({
      supervisionId: input.supervisionId,
      ownerAgentId: binding.ownerAgentId,
      nowMs: Date.now(),
      durationMs: 300_000,
    });
    if (lease === null) throw new Error("The supervision owner is busy; retry after its cycle.");
    try {
      const candidates = (await listWorkspaces(input.root)).filter(
        (item) =>
          (input.workspaceId === undefined || item.workspaceId === input.workspaceId) &&
          // A conversation's generations retire with their conversation, never as supervision's.
          !isConversationWorkspace(item) &&
          (item.state === "ready" ||
            (item.state === "recovery_required" && item.recoveryReason === "unstarted_retirement")),
      );
      const results = [];
      for (const workspace of candidates) {
        try {
          results.push(
            await retireUnstartedSupervisionWorkspace({
              repositoryRoot: input.root,
              binding,
              workspaceId: workspace.workspaceId,
            }),
          );
        } catch (error) {
          results.push({
            workspaceId: workspace.workspaceId,
            status: "refused" as const,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return { results };
    } finally {
      leases.release(lease);
    }
  } finally {
    leases.close();
  }
}
