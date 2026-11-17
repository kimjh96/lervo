import { maintainNodeRuntimeRetention } from "./node-runtime-retention.js";
import { pinRuntimeRollbackPredecessor } from "./node-runtime-rollback-pins.js";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { loadNodeRuntimeConfig } from "@lervo/node-runtime";
import {
  createNodeFleetOnboardingPlan,
  registerNodeFleetInstance,
  registerRepository,
  repositoryRegistryPathBesideNodeFleet,
  type NodeFleetOnboardingPlan,
  type NodeFleetServiceManager,
  type RegisterNodeFleetInstanceResult,
} from "@lervo/repository-registry";

// These release-tested service primitives are bundled into the installed CLI.
// @ts-expect-error The repository service script intentionally remains plain ESM.
import { manageRuntimeService } from "../../../scripts/distribution/manage-runtime-service.mjs";
// @ts-expect-error The repository service script intentionally remains plain ESM.
import { RuntimeServiceManagementError } from "../../../scripts/distribution/manage-runtime-service.mjs";
// @ts-expect-error The repository service script intentionally remains plain ESM.
import { createRuntimeServiceDefinition } from "../../../scripts/distribution/render-runtime-service.mjs";

import {
  failNodeFleetApply as fail,
  NodeFleetApplyError,
  recoverNodeFleetFailure,
  type NodeFleetApplyPorts,
  type NodeFleetApplyReceipt,
  type NodeFleetServiceResult,
} from "./node-fleet-apply-contract.js";
import {
  captureNodeFleetReadinessBaseline,
  observeNodeFleetReadiness,
} from "./node-fleet-readiness.js";
import { transitionLegacyNodeSingleton } from "./node-fleet-legacy-transition.js";
import { pointCurrentNodeRuntimeAt } from "./node-runtime-pointer.js";
import { nodeServiceToolDirectories } from "./node-service-tool-directories.js";
import {
  assertNodeFleetExecutable,
  materializeInstalledNodeLauncher,
  type DescribeInstalledNodeLauncher,
} from "./node-fleet-runtime-material.js";

export * from "./node-fleet-apply-contract.js";
export { inspectNodeFleetStatus } from "./node-fleet-health.js";
export {
  captureNodeFleetReadinessBaseline,
  observeNodeFleetReadiness,
} from "./node-fleet-readiness.js";
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
  pathDirectories: readonly string[];
  previousDefinition?: string;
  configurationSource?: string;
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
    ...(input.pathDirectories.length === 0
      ? []
      : ["--path-directories", input.pathDirectories.join(":")]),
    "--config",
    input.config,
    ...(input.configurationSource === undefined
      ? []
      : ["--configuration-source", input.configurationSource]),
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
  /**
   * ADR-0470 tool directories for the service PATH, as the reviewed upgrade plan resolved them;
   * absent resolves them now from this shell's PATH.
   */
  pathDirectories?: readonly string[];
  /**
   * ADR-0489: owner-only replacement configuration bytes. The service transition applies them
   * while the Node is stopped and restarts even an unchanged definition.
   */
  configurationSource?: string;
  /** ADR-0579: the caller's description of the bundled runtime; absent, it is read again. */
  describeLauncher?: DescribeInstalledNodeLauncher;
}): Promise<NodeFleetApplyReceipt> {
  const startedAt = performance.now();
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
  // A Node's checkout is a repository this host knows. Joining the host repository registry before
  // any service effect keeps `lervo repository list|resolve` consistent with the fleet, and a
  // conflicting stale entry stops onboarding while nothing has changed yet.
  await registerRepository({
    registryPath: repositoryRegistryPathBesideNodeFleet(current.registry.path),
    repositoryRoot: current.desired.repositoryRoot,
  }).catch((error: unknown) =>
    fail(
      "node_fleet_repository_registration_failed",
      "The repository could not join the host repository registry.",
      error,
    ),
  );
  const pathDirectories =
    input.pathDirectories ??
    (
      await nodeServiceToolDirectories({
        repositoryRoot: current.desired.repositoryRoot,
        configPath,
      })
    ).directories;
  const executable =
    ports.executablePath === undefined
      ? await materializeInstalledNodeLauncher(input.homeDirectory, input.describeLauncher)
      : await assertNodeFleetExecutable(resolve(ports.executablePath));
  const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "lervo-node-service-"));
  const definition = resolve(temporaryDirectory, "service-definition");
  const previousDefinition = resolve(temporaryDirectory, "previous-service-definition");
  // An existing service's health is the regression baseline; a first install has none.
  const baseline =
    current.service.targetState === "present_unverified"
      ? await captureNodeFleetReadinessBaseline(current.desired.healthPath, ports, new Date())
      : ({ status: "not_applicable" } as const);
  const appliedAt = new Date();
  let service: NodeFleetServiceResult | null = null;
  let compensated = false;
  let registryCommitted = false;
  let rollbackDefinition = true;
  let serviceStartedAt: number;
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
          pathDirectories,
        }),
        options,
      );
    } else if (service.change === "upgraded" && rollbackDefinition) {
      await manageRuntimeService(
        serviceArgs({
          action: "rollback",
          manager: current.desired.serviceManager,
          instance: current.desired.serviceInstanceId,
          definition,
          previousDefinition,
          executable,
          config: configPath,
          pathDirectories,
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
      pathDirectories,
    });
    await writeFile(definition, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await chmod(definition, 0o600);
    const desiredHash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    serviceStartedAt = performance.now();
    const definitionChanged = current.service.targetContentHash !== desiredHash;
    if (input.configurationSource !== undefined && current.service.targetContentHash === null)
      fail(
        "node_fleet_config_transition_unavailable",
        "A configuration transition requires an installed repository Node service.",
      );
    if (
      current.service.targetContentHash !== null &&
      (definitionChanged || input.configurationSource !== undefined)
    ) {
      // An unchanged definition with a configuration replacement has nothing to roll back to.
      rollbackDefinition = definitionChanged;
      const currentBytes = await readFile(current.service.targetPath);
      const observedHash = `sha256:${createHash("sha256").update(currentBytes).digest("hex")}`;
      if (observedHash !== current.service.targetContentHash)
        fail("node_fleet_plan_stale", "The installed service changed before upgrade.");
      if (definitionChanged)
        await pinRuntimeRollbackPredecessor({
          servicePath: current.service.targetPath,
          definition: currentBytes.toString("utf8"),
          ...(input.homeDirectory === undefined ? {} : { homeDirectory: input.homeDirectory }),
        });
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
          pathDirectories,
          ...(input.configurationSource === undefined
            ? {}
            : { configurationSource: input.configurationSource }),
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
          pathDirectories,
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
    const readinessStartedAt = performance.now();
    const readiness = await observeNodeFleetReadiness({
      path: current.desired.healthPath,
      notBefore: appliedAt,
      ports,
      allowHubUnavailable: input.allowHubUnavailableReadiness === true,
      baseline,
    });
    const completionStartedAt = performance.now();
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
      await recoverNodeFleetFailure(error, compensate, "Fleet registration");
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
    // ADR-0483: the activated runtime becomes this host's `current`. A failed swap leaves the
    // previous pointer, which the next `lervo upgrade` repairs; onboarding itself succeeded.
    await pointCurrentNodeRuntimeAt(executable, input.homeDirectory).catch(() => undefined);
    await maintainNodeRuntimeRetention(
      input.homeDirectory === undefined ? {} : { homeDirectory: input.homeDirectory },
    );
    return {
      schemaVersion: 1,
      operation: "repository_node_onboarding",
      planId: current.planId,
      service,
      readiness,
      registry,
      timing: {
        preparationMs: Math.round(serviceStartedAt - startedAt),
        serviceMs: Math.round(readinessStartedAt - serviceStartedAt),
        readinessMs: Math.round(completionStartedAt - readinessStartedAt),
        completionMs: Math.round(performance.now() - completionStartedAt),
      },
    };
  } catch (error) {
    if (!registryCommitted) await recoverNodeFleetFailure(error, compensate, "Node onboarding");
    if (error instanceof NodeFleetApplyError) throw error;
    if (error instanceof RuntimeServiceManagementError)
      fail(
        (error as { code: string }).code,
        // Service management messages are fixed, path-free texts, so the real reason is shown.
        `The repository Node service operation failed. ${(error as Error).message}`,
        error,
      );
    fail("node_fleet_apply_failed", "The repository Node onboarding operation failed.", error);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
