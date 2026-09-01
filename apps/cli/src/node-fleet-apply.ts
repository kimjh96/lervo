import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { loadNodeRuntimeConfig } from "@lervo/node-runtime";
import {
  createNodeFleetOnboardingPlan,
  registerNodeFleetInstance,
  type NodeFleetOnboardingPlan,
  type NodeFleetServiceManager,
  type RegisterNodeFleetInstanceResult,
} from "@lervo/repository-registry";

// These release-tested service primitives are bundled into the installed CLI.
// @ts-expect-error The repository service script intentionally remains plain ESM.
import { manageRuntimeService } from "../../../scripts/manage-runtime-service.mjs";
// @ts-expect-error The repository service script intentionally remains plain ESM.
import { createRuntimeServiceDefinition } from "../../../scripts/render-runtime-service.mjs";

import {
  failNodeFleetApply as fail,
  NodeFleetApplyError,
  type NodeFleetApplyPorts,
  type NodeFleetApplyReceipt,
  type NodeFleetServiceResult,
} from "./node-fleet-apply-contract.js";
import { observeNodeFleetReadiness } from "./node-fleet-health.js";
import { transitionLegacyNodeSingleton } from "./node-fleet-legacy-transition.js";
import {
  assertNodeFleetExecutable,
  materializeInstalledNodeLauncher,
} from "./node-fleet-runtime-material.js";

export * from "./node-fleet-apply-contract.js";
export { inspectNodeFleetStatus, observeNodeFleetReadiness } from "./node-fleet-health.js";
export { assertNodeFleetExecutable } from "./node-fleet-runtime-material.js";

function safeAbsolute(value: string): boolean {
  return resolve(value) === value && !/[\0\r\n]/u.test(value);
}

function serviceArgs(input: {
  action: "install" | "upgrade" | "rollback" | "remove";
  manager: NodeFleetServiceManager;
  instance: string;
  definition: string;
  executable: string;
  config: string;
  previousDefinition?: string;
}): string[] {
  return [
    "--action",
    input.action,
    "--manager",
    input.manager,
    "--runtime",
    "node",
    "--instance",
    input.instance,
    "--definition",
    input.definition,
    ...(input.previousDefinition === undefined
      ? []
      : ["--previous-definition", input.previousDefinition]),
    "--executable",
    input.executable,
    "--config",
    input.config,
    "--write",
  ];
}

export async function applyNodeFleetOnboarding(input: {
  plan: NodeFleetOnboardingPlan;
  configPath: string;
  homeDirectory?: string;
  ports?: NodeFleetApplyPorts;
  transitionLegacy?: boolean;
  allowHubUnavailableReadiness?: boolean;
}): Promise<NodeFleetApplyReceipt> {
  const ports = input.ports ?? {};
  const planInput = {
    registryPath: input.plan.registry.path,
    repositoryRoot: input.plan.desired.repositoryRoot,
    nodeId: input.plan.desired.nodeId,
    destinationId: input.plan.desired.destinationId,
    runtimeVersion: input.plan.desired.runtimeVersion,
    serviceManager: input.plan.desired.serviceManager,
    ...(input.homeDirectory === undefined ? {} : { homeDirectory: input.homeDirectory }),
  };
  const current = await createNodeFleetOnboardingPlan(planInput);
  if (current.planId !== input.plan.planId)
    fail("node_fleet_plan_stale", "The Node fleet plan changed before apply.");
  if (current.service.targetState === "conflict")
    fail("node_fleet_service_conflict", "The repository service target is unsafe or conflicting.");
  if (current.service.legacyTargetState !== "absent" && !input.transitionLegacy)
    fail(
      "node_fleet_legacy_transition_required",
      "A legacy singleton service requires explicit transition authority.",
    );
  if (input.transitionLegacy && current.service.legacyTargetState !== "present_unverified")
    fail(
      "node_fleet_legacy_transition_required",
      "The legacy singleton is absent or unsafe and cannot be transitioned.",
    );

  const configPath = resolve(input.configPath);
  if (!safeAbsolute(configPath))
    fail("node_fleet_config_invalid", "The Node runtime config path must be absolute and safe.");
  const config = await loadNodeRuntimeConfig(configPath).catch((error: unknown) =>
    fail("node_fleet_config_invalid", "The Node runtime config could not be verified.", error),
  );
  const configRoot = await realpath(config.repositoryRoot).catch((error: unknown) =>
    fail(
      "node_fleet_config_invalid",
      "The configured repository root could not be verified.",
      error,
    ),
  );
  if (
    configRoot !== current.desired.repositoryRoot ||
    config.hub.destinationId !== current.desired.destinationId ||
    (config.remoteCommands !== undefined && config.remoteCommands.nodeId !== current.desired.nodeId)
  ) {
    fail(
      "node_fleet_config_mismatch",
      "The runtime config does not match the planned repository, destination, or Node identity.",
    );
  }
  const executable =
    ports.executablePath === undefined
      ? await materializeInstalledNodeLauncher(input.homeDirectory)
      : await assertNodeFleetExecutable(resolve(ports.executablePath));
  const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "lervo-node-service-"));
  const definition = resolve(temporaryDirectory, "service-definition");
  const previousDefinition = resolve(temporaryDirectory, "previous-service-definition");
  const appliedAt = new Date();
  let service: NodeFleetServiceResult | null = null;
  let compensated = false;
  let registryCommitted = false;
  const options = {
    ...ports.serviceOptions,
    ...(input.homeDirectory === undefined ? {} : { homeDirectory: input.homeDirectory }),
  };
  const compensate = async (): Promise<void> => {
    if (compensated || service === null) return;
    compensated = true;
    if (service.change === "installed") {
      await manageRuntimeService(
        serviceArgs({
          action: "remove",
          manager: current.desired.serviceManager,
          instance: current.desired.serviceInstanceId,
          definition,
          executable,
          config: configPath,
        }),
        options,
      );
    } else if (service.change === "upgraded") {
      await manageRuntimeService(
        serviceArgs({
          action: "rollback",
          manager: current.desired.serviceManager,
          instance: current.desired.serviceInstanceId,
          definition,
          previousDefinition,
          executable,
          config: configPath,
        }),
        options,
      );
    }
  };
  try {
    const content = await createRuntimeServiceDefinition({
      manager: current.desired.serviceManager,
      runtime: "node",
      instance: current.desired.serviceInstanceId,
      executable,
      config: configPath,
    });
    await writeFile(definition, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await chmod(definition, 0o600);
    const desiredHash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    if (
      current.service.targetContentHash !== null &&
      current.service.targetContentHash !== desiredHash
    ) {
      const currentBytes = await readFile(current.service.targetPath);
      const observedHash = `sha256:${createHash("sha256").update(currentBytes).digest("hex")}`;
      if (observedHash !== current.service.targetContentHash)
        fail("node_fleet_plan_stale", "The installed service changed before upgrade.");
      await writeFile(previousDefinition, currentBytes, { mode: 0o600, flag: "wx" });
      await chmod(previousDefinition, 0o600);
      service = (await manageRuntimeService(
        serviceArgs({
          action: "upgrade",
          manager: current.desired.serviceManager,
          instance: current.desired.serviceInstanceId,
          definition,
          previousDefinition,
          executable,
          config: configPath,
        }),
        options,
      )) as NodeFleetServiceResult;
    } else {
      service = (await manageRuntimeService(
        serviceArgs({
          action: "install",
          manager: current.desired.serviceManager,
          instance: current.desired.serviceInstanceId,
          definition,
          executable,
          config: configPath,
        }),
        options,
      )) as NodeFleetServiceResult;
    }
    if (
      !service.managerAvailable ||
      !service.installed ||
      !service.active ||
      service.enabled === false
    )
      fail("node_fleet_service_unavailable", "The repository service did not remain active.");
    const readiness = await observeNodeFleetReadiness(
      current.desired.healthPath,
      appliedAt,
      ports,
      input.allowHubUnavailableReadiness === true,
    );
    let registry: RegisterNodeFleetInstanceResult;
    try {
      registry = await registerNodeFleetInstance({
        registryPath: current.registry.path,
        repositoryRoot: current.desired.repositoryRoot,
        nodeId: current.desired.nodeId,
        destinationId: current.desired.destinationId,
        runtimeVersion: current.desired.runtimeVersion,
        serviceManager: current.desired.serviceManager,
      });
      registryCommitted = true;
    } catch (error) {
      await compensate().catch((recoveryError: unknown) =>
        fail(
          "node_fleet_recovery_failed",
          "Fleet registration failed and the prior service state could not be restored.",
          recoveryError,
        ),
      );
      fail(
        "node_fleet_registry_apply_failed",
        "Runtime readiness was observed but fleet registration failed.",
        error,
      );
    }
    if (input.transitionLegacy && current.service.legacyTargetState === "present_unverified") {
      await transitionLegacyNodeSingleton({
        manager: current.desired.serviceManager,
        path: current.service.legacyTargetPath,
        contentHash: current.service.legacyTargetContentHash!,
        configPath,
        ...(input.homeDirectory === undefined ? {} : { homeDirectory: input.homeDirectory }),
        ...(ports.serviceOptions === undefined ? {} : { serviceOptions: ports.serviceOptions }),
      });
    }
    return {
      schemaVersion: 1,
      operation: "repository_node_onboarding",
      planId: current.planId,
      service,
      readiness,
      registry,
    };
  } catch (error) {
    if (!registryCommitted)
      await compensate().catch((recoveryError: unknown) =>
        fail(
          "node_fleet_recovery_failed",
          "Node onboarding failed and the prior service state could not be restored.",
          recoveryError,
        ),
      );
    if (error instanceof NodeFleetApplyError) throw error;
    fail("node_fleet_apply_failed", "The repository Node onboarding operation failed.", error);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
