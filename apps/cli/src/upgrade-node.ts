import { readFile, realpath } from "node:fs/promises";

import {
  createNodeFleetOnboardingPlan,
  defaultNodeFleetRegistryPath,
  listNodeFleetInstances,
  type NodeFleetOnboardingPlan,
} from "@lervo/repository-registry";

// @ts-expect-error The repository service script intentionally remains plain ESM.
import { formatRuntimeServiceDefinition } from "../../../scripts/distribution/render-runtime-service.mjs";

import {
  inspectNodeConfigExecutables,
  nodeConfigExecutablesPending,
} from "./node-config-executable-upgrade.js";
import { inspectNodeFleetStatus } from "./node-fleet-apply.js";
import { nodeRuntimeHasOnlyAuxiliaryConditions } from "./node-fleet-readiness-policy.js";
import {
  describeInstalledNodeLauncher,
  inspectInstalledNodeDependencies,
  type DescribeInstalledNodeLauncher,
  type InstalledNodeLauncher,
} from "./node-fleet-runtime-material.js";
import { readNodeServiceCoordinates } from "./node-service-coordinates.js";
import { nodeServiceToolDirectories } from "./node-service-tool-directories.js";

import {
  sha256,
  stage,
  type NodeUpgradeInspection,
  type NodeUpgradeStage,
} from "./upgrade-node-stage.js";

export { parseNodeServiceCoordinates } from "./node-service-coordinates.js";
export type { NodeUpgradeInspection, NodeUpgradeStage } from "./upgrade-node-stage.js";

/** The installed definition's coordinates, or the legacy singleton's while it is the only one. */
async function safeServiceCoordinates(
  plan: NodeFleetOnboardingPlan,
): Promise<{ executable: string; config: string } | null> {
  const legacyOnly =
    plan.service.targetState === "absent" &&
    plan.service.legacyTargetState === "present_unverified";
  if (plan.service.targetState !== "present_unverified" && !legacyOnly) return null;
  try {
    const coordinates = await readNodeServiceCoordinates({
      manager: plan.desired.serviceManager,
      path: legacyOnly ? plan.service.legacyTargetPath : plan.service.targetPath,
      expectedContentHash: legacyOnly
        ? plan.service.legacyTargetContentHash
        : plan.service.targetContentHash,
    });
    return { executable: coordinates.executable, config: coordinates.config };
  } catch {
    return null;
  }
}

export async function inspectRegisteredNodeUpgrade(
  root: string,
  projectId: string,
  desiredVersion: string,
  describeLauncher: DescribeInstalledNodeLauncher = describeInstalledNodeLauncher,
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
      // ADR-0561: Lervo reports the policy gap as its own debt instead of asking the owner.
      return {
        stage: stage({
          ...common,
          disposition: "lervo_debt",
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
  if (plan.service.legacyTargetState === "conflict")
    return {
      stage: stage({
        ...planFields,
        disposition: "blocked",
        reason: "legacy_node_service_conflict",
      }),
      plan,
      configPath: null,
    };
  const transitionLegacy = plan.service.legacyTargetState === "present_unverified";
  const coordinates = await safeServiceCoordinates(plan);
  if (coordinates === null)
    return {
      stage: stage({
        ...planFields,
        disposition: plan.service.targetState === "conflict" ? "blocked" : "lervo_debt",
        reason:
          plan.service.targetState === "conflict"
            ? "node_service_target_conflict"
            : "node_config_path_recovery_required",
      }),
      plan,
      configPath: null,
    };
  let desired: InstalledNodeLauncher;
  try {
    desired = await describeLauncher();
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
  const executables = await inspectNodeConfigExecutables(coordinates.config);
  const inspected = (
    value: NodeUpgradeStage,
    replaceDeployment = false,
  ): NodeUpgradeInspection => ({
    stage: { ...value, desiredServiceHash, configExecutables: executables.stage },
    plan,
    configPath: coordinates.config,
    pathDirectories: tools.directories,
    configExecutables: executables,
    replaceDeployment,
  });
  // The legacy singleton is replaced by the repository service in one guarded transition.
  if (transitionLegacy)
    return {
      ...inspected(
        stage({ ...deploymentFields, disposition: "safe_apply", reason: "legacy_node_transition" }),
        true,
      ),
      transitionLegacy: true,
    };
  // A current deployment still applies when the CLI pointer or the configuration is stale; a
  // configuration change restarts the same service definition through the guarded transition.
  const deployed = (value: NodeUpgradeStage): NodeUpgradeInspection =>
    nodeConfigExecutablesPending(executables.stage)
      ? inspected(
          stage({
            ...deploymentFields,
            disposition: "safe_apply",
            reason: "node_config_executables_stale",
          }),
        )
      : inspected(value);
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
  if (deploymentCurrent) {
    const dependencies = await inspectInstalledNodeDependencies(desired);
    if (dependencies === "conflict")
      return inspected(
        stage({
          ...deploymentFields,
          disposition: "blocked",
          reason: "node_runtime_dependency_conflict",
        }),
      );
    if (dependencies === "missing")
      return inspected(
        stage({
          ...deploymentFields,
          disposition: "safe_apply",
          reason: "node_runtime_dependencies_missing",
        }),
        true,
      );
  }
  if (deploymentCurrent && status?.recoveryAction === "none")
    return deployed(
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
    return deployed(
      stage({
        ...deploymentFields,
        disposition: "current",
        reason: "exact_runtime_deployed_hub_unavailable",
      }),
    );
  if (
    deploymentCurrent &&
    status !== undefined &&
    status.recoveryAction === "inspect_runtime_failure" &&
    nodeRuntimeHasOnlyAuxiliaryConditions(status.runtime)
  )
    return deployed(
      stage({
        ...deploymentFields,
        disposition: "current",
        reason: "exact_runtime_deployed_runtime_attention",
      }),
    );
  if (deploymentCurrent && status !== undefined && status.recoveryAction !== "reapply_exact_plan")
    return deployed(
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
    true,
  );
}

export { applyRegisteredNodeUpgrade } from "./upgrade-node-apply.js";
