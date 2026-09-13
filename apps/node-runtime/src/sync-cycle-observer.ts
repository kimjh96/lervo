import { runWorkstreamReplicationCycle, type SyncCycleResult } from "@lervo/sync";
import { reconcileHubWorkspaceSummaries } from "@lervo/workspace-reservation-hub";
import type { NodeRuntimeHealthPublisher } from "./health.js";

function failureCode(error: unknown, fallback: string): string {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : fallback;
}

/** Replication and coordination remain serial with the outbound sync cycle. */
export function createSyncCycleObserver(input: {
  health: NodeRuntimeHealthPublisher;
  workstreams: () => Parameters<typeof runWorkstreamReplicationCycle>[0];
  workspaces?: Parameters<typeof reconcileHubWorkspaceSummaries>[0];
  onCycle?: (result: SyncCycleResult) => void | Promise<void>;
}) {
  return async (result: SyncCycleResult): Promise<void> => {
    await input.health.observeSync(result);
    if (result.status === "idle" || result.status === "synchronized") {
      try {
        await input.health.observeWorkstreamReplication(
          await runWorkstreamReplicationCycle(input.workstreams()),
        );
      } catch (error) {
        await input.health.observeWorkstreamReplicationFailure(
          failureCode(error, "workstream_replication_failed"),
        );
      }
      if (input.workspaces !== undefined) {
        try {
          await reconcileHubWorkspaceSummaries(input.workspaces);
          await input.health.observeWorkspaceCoordination();
        } catch (error) {
          await input.health.observeWorkspaceCoordinationFailure(
            failureCode(error, "workspace_coordination_failed"),
          );
        }
      }
    } else {
      await input.health.observeWorkstreamReplicationFailure(result.failureCode);
      if (input.workspaces !== undefined)
        await input.health.observeWorkspaceCoordinationFailure(result.failureCode);
    }
    await input.onCycle?.(result);
  };
}
