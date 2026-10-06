import { lstat, readFile } from "node:fs/promises";

import { readNodeRuntimeHealthSnapshot, type NodeRuntimeHealthSnapshot } from "@lervo/node-runtime";
import { listNodeFleetInstances } from "@lervo/repository-registry";

import {
  failNodeFleetApply,
  type NodeFleetApplyPorts,
  type NodeFleetServiceResult,
  type NodeFleetStatusReport,
} from "./node-fleet-apply-contract.js";
import { nodeReadinessComponentText as componentStatus } from "./node-fleet-readiness-policy.js";

// @ts-expect-error The repository service script intentionally remains plain ESM.
import { manageRuntimeService } from "../../../scripts/distribution/manage-runtime-service.mjs";

const maximumHealthBytes = 64 * 1024;

/** Reads one owner-only, bounded Node health snapshot or fails with a typed readiness code. */
export async function readNodeFleetHealthSnapshot(
  path: string,
): Promise<NodeRuntimeHealthSnapshot> {
  const metadata = await lstat(path);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > maximumHealthBytes ||
    (process.platform !== "win32" && (metadata.mode & 0o077) !== 0)
  ) {
    failNodeFleetApply(
      "node_fleet_readiness_invalid",
      "The Node runtime health snapshot is unsafe.",
    );
  }
  try {
    return readNodeRuntimeHealthSnapshot(JSON.parse(await readFile(path, "utf8")));
  } catch {
    failNodeFleetApply(
      "node_fleet_readiness_unavailable",
      "The Node runtime health snapshot is invalid.",
    );
  }
}

async function readReportedHealth(path: string): Promise<NodeRuntimeHealthSnapshot | null> {
  try {
    return await readNodeFleetHealthSnapshot(path);
  } catch {
    return null;
  }
}

export async function inspectNodeFleetStatus(input: {
  registryPath: string;
  homeDirectory?: string;
  ports?: Pick<NodeFleetApplyPorts, "serviceOptions">;
  now?: Date;
}): Promise<NodeFleetStatusReport> {
  const registrations = await listNodeFleetInstances(input.registryPath);
  const now = input.now ?? new Date();
  const instances = await Promise.all(
    registrations.map(async (registration) => {
      const service = (await manageRuntimeService(
        [
          "--action",
          "status",
          "--manager",
          registration.serviceManager,
          "--runtime",
          "node",
          "--instance",
          registration.serviceInstanceId,
        ],
        {
          ...input.ports?.serviceOptions,
          ...(input.homeDirectory === undefined ? {} : { homeDirectory: input.homeDirectory }),
        },
      )) as NodeFleetServiceResult;
      const health = await readReportedHealth(registration.healthPath);
      const operational =
        service.managerAvailable &&
        service.installed &&
        service.active &&
        service.enabled !== false;
      const stale = health !== null && now.getTime() - Date.parse(health.updatedAt) > 2 * 60_000;
      const runtimeStatus =
        health === null ? ("unavailable" as const) : stale ? ("stale" as const) : health.status;
      const ready = operational && runtimeStatus === "ready";
      return {
        projectId: registration.projectId,
        serviceInstanceId: registration.serviceInstanceId,
        repositoryRoot: registration.repositoryRoot,
        destinationId: registration.destinationId,
        runtimeVersion: registration.runtimeVersion,
        service: {
          managerAvailable: service.managerAvailable,
          installed: service.installed,
          active: service.active,
          enabled: service.enabled,
        },
        runtime: {
          status: runtimeStatus,
          sync: componentStatus(health?.sync),
          workstreamReplication: componentStatus(health?.workstreamReplication),
          workspaceCoordination: componentStatus(health?.workspaceCoordination),
          remoteControl: componentStatus(health?.remoteControl),
          conversation:
            health === null
              ? "unavailable"
              : health.conversation === undefined
                ? "disabled"
                : componentStatus(health.conversation),
          supervision:
            health === null
              ? "unavailable"
              : health.supervision === undefined
                ? "disabled"
                : componentStatus(health.supervision),
          updatedAt: health?.updatedAt ?? null,
        },
        recoveryAction: ready
          ? ("none" as const)
          : !operational
            ? ("reapply_exact_plan" as const)
            : runtimeStatus === "starting"
              ? ("wait_for_runtime" as const)
              : ("inspect_runtime_failure" as const),
      };
    }),
  );
  return {
    schemaVersion: 1,
    status: instances.every((item) => item.recoveryAction === "none") ? "ready" : "degraded",
    instances,
  };
}
