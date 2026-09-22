import { lstat, readFile } from "node:fs/promises";

import { readNodeRuntimeHealthSnapshot, type NodeRuntimeHealthSnapshot } from "@lervo/node-runtime";
import { listNodeFleetInstances } from "@lervo/repository-registry";

import {
  failNodeFleetApply,
  type NodeFleetApplyPorts,
  type NodeFleetApplyReceipt,
  type NodeFleetServiceResult,
  type NodeFleetStatusReport,
} from "./node-fleet-apply-contract.js";

// @ts-expect-error The repository service script intentionally remains plain ESM.
import { manageRuntimeService } from "../../../scripts/distribution/manage-runtime-service.mjs";

const readyObservations = 3;
const readyIntervalMs = 500;
const readyMaximumObservations = 120;
const maximumHealthBytes = 64 * 1024;

async function readHealthSnapshot(path: string): Promise<NodeRuntimeHealthSnapshot> {
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
    return await readHealthSnapshot(path);
  } catch {
    return null;
  }
}

function componentStatus(
  value: { status: string; failureCode?: string; reasonCode?: string } | undefined,
): string {
  return value === undefined
    ? "unavailable"
    : value.status === "unavailable"
      ? `unavailable:${value.failureCode ?? "unknown"}`
      : value.status === "dormant"
        ? `dormant:${value.reasonCode ?? "unknown"}`
        : value.status === "attention"
          ? `attention:${value.reasonCode ?? "unknown"}`
          : value.status;
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

export async function observeNodeFleetReadiness(
  path: string,
  notBefore: Date,
  ports: NodeFleetApplyPorts,
  allowHubUnavailable: boolean,
): Promise<NodeFleetApplyReceipt["readiness"]> {
  const read = ports.readHealth ?? readHealthSnapshot;
  const wait =
    ports.wait ??
    ((durationMs: number) => new Promise<void>((done) => setTimeout(done, durationMs)));
  let consecutive = 0;
  let identity: string | null = null;
  let previousUpdatedAt = 0;
  let last: NodeRuntimeHealthSnapshot | null = null;
  for (let attempt = 0; attempt < readyMaximumObservations; attempt += 1) {
    try {
      const current = await read(path);
      const currentIdentity = `${current.processId}\0${current.startedAt}`;
      const updatedAt = Date.parse(current.updatedAt);
      const hubUnavailable = (component: NodeRuntimeHealthSnapshot["sync"]): boolean =>
        component.status === "unavailable" && component.failureCode === "hub_unavailable";
      const syncReady =
        current.sync.status === "ready" || (allowHubUnavailable && hubUnavailable(current.sync));
      const workstreamReady =
        current.workstreamReplication.status === "ready" ||
        (allowHubUnavailable && hubUnavailable(current.workstreamReplication));
      const remoteReady =
        current.remoteControl.status === "ready" ||
        current.remoteControl.status === "disabled" ||
        (allowHubUnavailable && hubUnavailable(current.remoteControl));
      const workspaceReady =
        current.workspaceCoordination.status === "ready" ||
        current.workspaceCoordination.status === "disabled" ||
        (allowHubUnavailable && hubUnavailable(current.workspaceCoordination));
      const offline =
        hubUnavailable(current.sync) ||
        hubUnavailable(current.workstreamReplication) ||
        hubUnavailable(current.workspaceCoordination) ||
        hubUnavailable(current.remoteControl);
      const complete =
        (current.status === "ready" ||
          (allowHubUnavailable && current.status === "degraded" && offline)) &&
        syncReady &&
        workstreamReady &&
        workspaceReady &&
        remoteReady &&
        updatedAt >= notBefore.getTime();
      if (
        complete &&
        (identity === null || identity === currentIdentity) &&
        updatedAt >= previousUpdatedAt
      ) {
        identity = currentIdentity;
        previousUpdatedAt = updatedAt;
        last = current;
        consecutive += 1;
        if (consecutive === readyObservations) {
          return {
            status: offline ? "offline_ready" : "ready",
            observations: 3,
            processId: current.processId,
            startedAt: current.startedAt,
            sync: componentStatus(current.sync) as NodeFleetApplyReceipt["readiness"]["sync"],
            workstreamReplication: componentStatus(
              current.workstreamReplication,
            ) as NodeFleetApplyReceipt["readiness"]["workstreamReplication"],
            workspaceCoordination: componentStatus(
              current.workspaceCoordination,
            ) as NodeFleetApplyReceipt["readiness"]["workspaceCoordination"],
            remoteControl: componentStatus(
              current.remoteControl,
            ) as NodeFleetApplyReceipt["readiness"]["remoteControl"],
          };
        }
      } else {
        consecutive = 0;
        identity = null;
        previousUpdatedAt = 0;
      }
    } catch {
      consecutive = 0;
      identity = null;
      previousUpdatedAt = 0;
    }
    await wait(readyIntervalMs);
  }
  failNodeFleetApply(
    "node_fleet_readiness_timeout",
    last === null
      ? "The Node runtime did not publish a safe readiness snapshot."
      : "The Node runtime did not remain completely ready for three observations.",
  );
}
