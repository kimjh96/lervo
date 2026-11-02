import {
  reconcileDivergentWorkstream,
  runWorkstreamReplicationCycle,
  type SyncCycleResult,
  type WorkstreamDivergenceResult,
} from "@lervo/sync";
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
  /** ADR-0561: the after-the-fact notice when divergent heads were reconciled without the owner. */
  onWorkstreamReconciled?: (
    result: Extract<WorkstreamDivergenceResult, { status: "reconciled" }>,
  ) => void | Promise<void>;
  /** A divergence that stays held as Lervo debt, with its bounded reason code. */
  onWorkstreamReconcileHeld?: (reasonCode: string) => void | Promise<void>;
  onCycle?: (result: SyncCycleResult) => void | Promise<void>;
}) {
  return async (result: SyncCycleResult): Promise<void> => {
    await input.health.observeSync(result);
    if (result.status === "idle" || result.status === "synchronized") {
      try {
        const cycle = input.workstreams();
        let replicated = await runWorkstreamReplicationCycle(cycle);
        if (replicated.status === "divergent") {
          // Keep the newest valid head and preserve the other; never wait for the owner to choose.
          // A failed attempt, such as against a Hub without exact revision reads, stays divergent.
          const reconciled = await reconcileDivergentWorkstream(cycle).catch(
            (error: unknown) =>
              ({ status: "failed", code: failureCode(error, "reconciliation_failed") }) as const,
          );
          if (reconciled.status === "reconciled") {
            await input.onWorkstreamReconciled?.(reconciled);
            replicated = await runWorkstreamReplicationCycle(cycle);
          } else if (reconciled.status !== "not_divergent")
            await input.onWorkstreamReconcileHeld?.(
              reconciled.status === "held" ? reconciled.reason : reconciled.code,
            );
        }
        await input.health.observeWorkstreamReplication(replicated);
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
