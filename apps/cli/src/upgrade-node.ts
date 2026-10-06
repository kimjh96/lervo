import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

import {
  createNodeFleetOnboardingPlan,
  defaultNodeFleetRegistryPath,
  listNodeFleetInstances,
  type NodeFleetOnboardingPlan,
} from "@lervo/repository-registry";

// @ts-expect-error The repository service script intentionally remains plain ESM.
import { formatRuntimeServiceDefinition } from "../../../scripts/distribution/render-runtime-service.mjs";

import { applyNodeFleetOnboarding, inspectNodeFleetStatus } from "./node-fleet-apply.js";
import { readNodeServiceCoordinates } from "./node-service-coordinates.js";
import { nodeServiceToolDirectories } from "./node-service-tool-directories.js";

export { parseNodeServiceCoordinates } from "./node-service-coordinates.js";

export interface NodeUpgradeStage {
  disposition: "current" | "safe_apply" | "pending_authority" | "blocked";
  registered: boolean;
  planId: string | null;
  runtimeVersion: { current: string | null; desired: string };
  runtimeBuildHash: string | null;
  configPathDigest: string | null;
  serviceTargetHash: string | null;
  /** ADR-0470: hash of the definition this upgrade renders, including tool directories. */
  desiredServiceHash?: string | null;
  reason: string;
  blockers?: Array<{ code: string; message: string }>;
}

export interface NodeUpgradeInspection {
  stage: NodeUpgradeStage;
  plan: NodeFleetOnboardingPlan | null;
  configPath: string | null;
  /** The resolved service PATH tool directories the apply renders. */
  pathDirectories?: string[];
}

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stage(input: {
  disposition: NodeUpgradeStage["disposition"];
  registered: boolean;
  planId: string | null;
  currentVersion: string | null;
  desiredVersion: string;
  runtimeBuildHash?: string | null;
  configPath?: string | null;
  serviceTargetHash?: string | null;
  reason: string;
}): NodeUpgradeStage {
  return {
    disposition: input.disposition,
    registered: input.registered,
    planId: input.planId,
    runtimeVersion: { current: input.currentVersion, desired: input.desiredVersion },
    runtimeBuildHash: input.runtimeBuildHash ?? null,
    configPathDigest:
      input.configPath === undefined || input.configPath === null ? null : sha256(input.configPath),
    serviceTargetHash: input.serviceTargetHash ?? null,
    reason: input.reason,
  };
}

async function safeServiceCoordinates(
  plan: NodeFleetOnboardingPlan,
): Promise<{ executable: string; config: string } | null> {
  if (plan.service.targetState !== "present_unverified") return null;
  try {
    const coordinates = await readNodeServiceCoordinates({
      manager: plan.desired.serviceManager,
      path: plan.service.targetPath,
      expectedContentHash: plan.service.targetContentHash,
    });
    return { executable: coordinates.executable, config: coordinates.config };
  } catch {
    return null;
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function desiredNodeRuntime(): Promise<{
  hash: string;
  launcher: string;
  payload: string;
  payloadBytes: Buffer;
  launcherContent: string;
}> {
  const bytes = await readFile(new URL("./node-runtime.js", import.meta.url));
  const hash = sha256(bytes);
  const hexadecimal = hash.slice("sha256:".length);
  const directory =
    process.platform === "darwin"
      ? resolve(
          homedir(),
          "Library",
          "Application Support",
          "Lervo",
          "runtimes",
          "node",
          hexadecimal.slice(0, 16),
        )
      : resolve(
          homedir(),
          ".local",
          "share",
          "lervo",
          "runtimes",
          "node",
          hexadecimal.slice(0, 16),
        );
  const payload = resolve(directory, "node-runtime.js");
  const launcher = resolve(directory, `lervo-node-launcher-${hexadecimal.slice(0, 12)}`);
  return {
    hash,
    launcher,
    payload,
    payloadBytes: bytes,
    launcherContent: `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(payload)} "$@"\n`,
  };
}

export async function inspectRegisteredNodeUpgrade(
  root: string,
  projectId: string,
  desiredVersion: string,
): Promise<NodeUpgradeInspection> {
  const registryPath = defaultNodeFleetRegistryPath();
  const physicalRoot = await realpath(root);
  const registration = (await listNodeFleetInstances(registryPath)).find(
    (item) => item.projectId === projectId || item.repositoryRoot === physicalRoot,
  );
  if (registration === undefined)
    return {
      stage: stage({
        disposition: "current",
        registered: false,
        planId: null,
        currentVersion: null,
        desiredVersion,
        reason: "node_not_configured",
      }),
      plan: null,
      configPath: null,
    };
  const common = { registered: true, currentVersion: registration.runtimeVersion, desiredVersion };
  let plan: NodeFleetOnboardingPlan;
  try {
    plan = await createNodeFleetOnboardingPlan({
      registryPath,
      repositoryRoot: physicalRoot,
      nodeId: registration.nodeId,
      destinationId: registration.destinationId,
      runtimeVersion: desiredVersion,
      serviceManager: registration.serviceManager,
    });
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "node_fleet_sync_disabled"
    ) {
      return {
        stage: stage({
          ...common,
          disposition: "pending_authority",
          planId: null,
          reason: "node_sync_policy_disabled",
        }),
        plan: null,
        configPath: null,
      };
    }
    throw error;
  }
  const planFields = {
    ...common,
    planId: plan.planId,
    serviceTargetHash: plan.service.targetContentHash,
  };
  if (plan.service.legacyTargetState !== "absent")
    return {
      stage: stage({
        ...planFields,
        disposition: "pending_authority",
        reason: "legacy_node_transition_requires_explicit_authority",
      }),
      plan,
      configPath: null,
    };
  const coordinates = await safeServiceCoordinates(plan);
  if (coordinates === null)
    return {
      stage: stage({
        ...planFields,
        disposition: plan.service.targetState === "conflict" ? "blocked" : "pending_authority",
        reason:
          plan.service.targetState === "conflict"
            ? "node_service_target_conflict"
            : "node_config_path_recovery_required",
      }),
      plan,
      configPath: null,
    };
  let desired: Awaited<ReturnType<typeof desiredNodeRuntime>>;
  try {
    desired = await desiredNodeRuntime();
  } catch {
    return {
      stage: stage({
        ...planFields,
        disposition: "blocked",
        configPath: coordinates.config,
        reason: "installed_node_runtime_payload_unavailable",
      }),
      plan,
      configPath: coordinates.config,
    };
  }
  const tools = await nodeServiceToolDirectories({
    repositoryRoot: physicalRoot,
    configPath: coordinates.config,
  });
  if (tools.missing.length > 0)
    return {
      stage: {
        ...stage({
          ...planFields,
          disposition: "blocked",
          runtimeBuildHash: desired.hash,
          configPath: coordinates.config,
          reason: "node_service_tool_unresolved",
        }),
        blockers: [
          {
            code: "service_tool_unresolved",
            message: `The repository Node runs ${tools.missing.join(", ")}, but no directory on this shell's PATH provides it. Install it or add its directory to PATH, then rerun \`lervo upgrade\`.`,
          },
        ],
      },
      plan,
      configPath: coordinates.config,
    };
  const desiredServiceHash = sha256(
    formatRuntimeServiceDefinition({
      manager: plan.desired.serviceManager,
      runtime: "node",
      instance: plan.desired.serviceInstanceId,
      executable: desired.launcher,
      config: coordinates.config,
      pathDirectories: tools.directories,
    }) as string,
  );
  const deploymentFields = {
    ...planFields,
    runtimeBuildHash: desired.hash,
    configPath: coordinates.config,
  };
  const inspected = (value: NodeUpgradeStage): NodeUpgradeInspection => ({
    stage: { ...value, desiredServiceHash },
    plan,
    configPath: coordinates.config,
    pathDirectories: tools.directories,
  });
  if (coordinates.executable === desired.launcher) {
    try {
      const [launcher, payload] = await Promise.all([
        readFile(desired.launcher, "utf8"),
        readFile(desired.payload),
      ]);
      if (launcher !== desired.launcherContent || !payload.equals(desired.payloadBytes))
        return {
          stage: stage({
            ...deploymentFields,
            disposition: "blocked",
            reason: "node_runtime_content_conflict",
          }),
          plan,
          configPath: coordinates.config,
        };
    } catch {
      return {
        stage: stage({
          ...deploymentFields,
          disposition: "blocked",
          reason: "node_runtime_content_unavailable",
        }),
        plan,
        configPath: coordinates.config,
      };
    }
  }
  const fleet = await inspectNodeFleetStatus({ registryPath });
  const status = fleet.instances.find((item) => item.projectId === projectId);
  const deploymentCurrent =
    coordinates.executable === desired.launcher &&
    plan.registry.reconciliation === "unchanged" &&
    desiredServiceHash === plan.service.targetContentHash;
  if (deploymentCurrent && status?.recoveryAction === "none")
    return inspected(
      stage({ ...deploymentFields, disposition: "current", reason: "exact_runtime_ready" }),
    );
  const hubUnavailableOnly =
    status !== undefined &&
    status.service.managerAvailable &&
    status.service.installed &&
    status.service.active &&
    status.service.enabled !== false &&
    [status.runtime.sync, status.runtime.workstreamReplication, status.runtime.remoteControl].every(
      (value) => ["ready", "disabled", "unavailable:hub_unavailable"].includes(value),
    ) &&
    [status.runtime.sync, status.runtime.workstreamReplication, status.runtime.remoteControl].some(
      (value) => value === "unavailable:hub_unavailable",
    );
  if (deploymentCurrent && hubUnavailableOnly)
    return inspected(
      stage({
        ...deploymentFields,
        disposition: "current",
        reason: "exact_runtime_deployed_hub_unavailable",
      }),
    );
  if (deploymentCurrent && status !== undefined && status.recoveryAction !== "reapply_exact_plan")
    return inspected(
      stage({
        ...deploymentFields,
        disposition: "blocked",
        reason: `node_runtime_${status.recoveryAction}`,
      }),
    );
  return inspected(
    stage({
      ...deploymentFields,
      disposition: "safe_apply",
      reason: deploymentCurrent
        ? "node_runtime_recovery"
        : coordinates.executable === desired.launcher &&
            plan.registry.reconciliation === "unchanged"
          ? "node_service_definition_changed"
          : "node_runtime_build_or_version_changed",
    }),
  );
}

export async function applyRegisteredNodeUpgrade(inspection: NodeUpgradeInspection): Promise<void> {
  if (
    inspection.plan === null ||
    inspection.configPath === null ||
    inspection.stage.configPathDigest !== sha256(inspection.configPath)
  )
    throw new Error("The registered Node upgrade inputs could not be revalidated.");
  await applyNodeFleetOnboarding({
    plan: inspection.plan,
    configPath: inspection.configPath,
    allowHubUnavailableReadiness: true,
    ...(inspection.pathDirectories === undefined
      ? {}
      : { pathDirectories: inspection.pathDirectories }),
  });
}
