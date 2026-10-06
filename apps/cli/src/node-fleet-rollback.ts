import { createHash } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  createNodeFleetOnboardingPlan,
  registerNodeFleetInstance,
  type NodeFleetOnboardingPlan,
  type RegisterNodeFleetInstanceResult,
} from "@lervo/repository-registry";

// These release-tested service primitives are bundled into the installed CLI.
// @ts-expect-error The repository service script intentionally remains plain ESM.
import { manageRuntimeService } from "../../../scripts/distribution/manage-runtime-service.mjs";
// @ts-expect-error The repository service script intentionally remains plain ESM.
import { createRuntimeServiceDefinition } from "../../../scripts/distribution/render-runtime-service.mjs";

import {
  assertNodeFleetExecutable,
  captureNodeFleetReadinessBaseline,
  NodeFleetApplyError,
  type NodeFleetApplyPorts,
  type NodeFleetApplyReceipt,
  observeNodeFleetReadiness,
  recoverNodeFleetFailure,
} from "./node-fleet-apply.js";
import { pointCurrentNodeRuntimeAt } from "./node-runtime-pointer.js";

type RollbackServiceResult = NodeFleetApplyReceipt["service"] & { change: "rolled_back" };

export interface NodeFleetRollbackReceipt {
  schemaVersion: 1;
  operation: "repository_node_rollback";
  planId: string;
  failedRuntimeVersion: string;
  predecessorRuntimeVersion: string;
  service: RollbackServiceResult;
  readiness: NodeFleetApplyReceipt["readiness"];
  registry: RegisterNodeFleetInstanceResult;
}

export interface NodeFleetRollbackPorts {
  createPlan?: typeof createNodeFleetOnboardingPlan;
  register?: typeof registerNodeFleetInstance;
  manageService?: (args: string[], options: Record<string, unknown>) => Promise<unknown>;
  renderDefinition?: (input: {
    manager: "systemd" | "launchd";
    runtime: "node";
    instance: string;
    executable: string;
    config: string;
  }) => Promise<string>;
  inspectExecutable?: (path: string) => Promise<string>;
  serviceOptions?: {
    platform?: NodeJS.Platform;
    homeDirectory?: string;
    uid?: number;
    runCommand?: (command: string, args: string[]) => Promise<{ exitCode: number | null }>;
    wait?: (durationMs: number) => Promise<void>;
  };
  wait?: (durationMs: number) => Promise<void>;
  readHealth?: NodeFleetApplyPorts["readHealth"];
  observeReadiness?: typeof observeNodeFleetReadiness;
}

function fail(code: string, message: string, cause?: unknown): never {
  throw new NodeFleetApplyError(code, message, cause === undefined ? undefined : { cause });
}

function serviceArgs(input: {
  action: "upgrade" | "rollback";
  manager: NodeFleetOnboardingPlan["desired"]["serviceManager"];
  instance: string;
  definition: string;
  previousDefinition: string;
  executable: string;
  config: string;
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
    "--previous-definition",
    input.previousDefinition,
    "--executable",
    input.executable,
    "--config",
    input.config,
    "--write",
  ];
}

export async function applyNodeFleetRollback(input: {
  plan: NodeFleetOnboardingPlan;
  failedRuntimeVersion: string;
  configPath: string;
  failedExecutablePath: string;
  predecessorExecutablePath: string;
  homeDirectory?: string;
  ports?: NodeFleetRollbackPorts;
  now?: () => Date;
}): Promise<NodeFleetRollbackReceipt> {
  const ports = input.ports ?? {};
  const createPlan = ports.createPlan ?? createNodeFleetOnboardingPlan;
  const register = ports.register ?? registerNodeFleetInstance;
  const manageService = ports.manageService ?? manageRuntimeService;
  const renderDefinition = ports.renderDefinition ?? createRuntimeServiceDefinition;
  const inspectExecutable = ports.inspectExecutable ?? assertNodeFleetExecutable;
  const observeReadiness = ports.observeReadiness ?? observeNodeFleetReadiness;
  const current = await createPlan({
    registryPath: input.plan.registry.path,
    repositoryRoot: input.plan.desired.repositoryRoot,
    nodeId: input.plan.desired.nodeId,
    destinationId: input.plan.desired.destinationId,
    runtimeVersion: input.plan.desired.runtimeVersion,
    serviceManager: input.plan.desired.serviceManager,
    ...(input.homeDirectory === undefined ? {} : { homeDirectory: input.homeDirectory }),
  });
  if (
    current.planId !== input.plan.planId ||
    current.registry.reconciliation !== "refresh" ||
    current.registry.current === null ||
    current.registry.current.runtimeVersion !== input.failedRuntimeVersion ||
    current.service.targetState !== "present_unverified" ||
    current.service.targetContentHash === null ||
    current.service.legacyTargetState !== "absent"
  ) {
    fail(
      "node_fleet_rollback_plan_invalid",
      "The local rollback plan does not bind one exact installed failed target and predecessor.",
    );
  }

  const configPath = resolve(input.configPath);
  const [failedExecutable, predecessorExecutable] = await Promise.all([
    inspectExecutable(resolve(input.failedExecutablePath)),
    inspectExecutable(resolve(input.predecessorExecutablePath)),
  ]);
  const [failedDefinition, predecessorDefinition] = await Promise.all([
    renderDefinition({
      manager: current.desired.serviceManager,
      runtime: "node",
      instance: current.desired.serviceInstanceId,
      executable: failedExecutable,
      config: configPath,
    }),
    renderDefinition({
      manager: current.desired.serviceManager,
      runtime: "node",
      instance: current.desired.serviceInstanceId,
      executable: predecessorExecutable,
      config: configPath,
    }),
  ]);
  const failedHash = `sha256:${createHash("sha256").update(failedDefinition).digest("hex")}`;
  if (
    failedHash !== current.service.targetContentHash ||
    failedDefinition === predecessorDefinition
  ) {
    fail(
      "node_fleet_rollback_plan_invalid",
      "The installed service is not the exact failed definition or has no distinct predecessor.",
    );
  }

  const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "lervo-node-rollback-"));
  const failedDefinitionPath = resolve(temporaryDirectory, "failed-service-definition");
  const predecessorDefinitionPath = resolve(temporaryDirectory, "predecessor-service-definition");
  const options = {
    ...ports.serviceOptions,
    ...(input.homeDirectory === undefined ? {} : { homeDirectory: input.homeDirectory }),
  };
  const readinessPorts: NodeFleetApplyPorts = {
    ...(ports.serviceOptions === undefined ? {} : { serviceOptions: ports.serviceOptions }),
    ...(ports.wait === undefined ? {} : { wait: ports.wait }),
    ...(ports.readHealth === undefined ? {} : { readHealth: ports.readHealth }),
  };
  const now = input.now ?? (() => new Date());
  // The failed target's health is the regression baseline the predecessor is judged against.
  const baseline = await captureNodeFleetReadinessBaseline(
    current.desired.healthPath,
    readinessPorts,
    now(),
  );
  let service: RollbackServiceResult | null = null;
  let registryCommitted = false;
  let compensated = false;
  const compensate = async (): Promise<void> => {
    if (service === null || compensated) return;
    compensated = true;
    await manageService(
      serviceArgs({
        action: "upgrade",
        manager: current.desired.serviceManager,
        instance: current.desired.serviceInstanceId,
        definition: failedDefinitionPath,
        previousDefinition: predecessorDefinitionPath,
        executable: failedExecutable,
        config: configPath,
      }),
      options,
    );
  };
  try {
    await Promise.all([
      writeFile(failedDefinitionPath, failedDefinition, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      }),
      writeFile(predecessorDefinitionPath, predecessorDefinition, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      }),
    ]);
    await Promise.all([
      chmod(failedDefinitionPath, 0o600),
      chmod(predecessorDefinitionPath, 0o600),
    ]);
    service = (await manageService(
      serviceArgs({
        action: "rollback",
        manager: current.desired.serviceManager,
        instance: current.desired.serviceInstanceId,
        definition: failedDefinitionPath,
        previousDefinition: predecessorDefinitionPath,
        executable: failedExecutable,
        config: configPath,
      }),
      options,
    )) as RollbackServiceResult;
    if (
      service.change !== "rolled_back" ||
      !service.managerAvailable ||
      !service.installed ||
      !service.active ||
      service.enabled === false
    ) {
      fail("node_fleet_rollback_failed", "The predecessor service did not remain active.");
    }
    const readiness = await observeReadiness({
      path: current.desired.healthPath,
      notBefore: now(),
      ports: readinessPorts,
      allowHubUnavailable: false,
      baseline,
    });
    let registry: RegisterNodeFleetInstanceResult;
    try {
      registry = await register({
        registryPath: current.registry.path,
        repositoryRoot: current.desired.repositoryRoot,
        nodeId: current.desired.nodeId,
        destinationId: current.desired.destinationId,
        runtimeVersion: current.desired.runtimeVersion,
        serviceManager: current.desired.serviceManager,
      });
      registryCommitted = true;
    } catch (error) {
      await recoverNodeFleetFailure(error, compensate, "Rollback registration");
      fail(
        "node_fleet_registry_apply_failed",
        "Predecessor readiness was observed but fleet registration failed.",
        error,
      );
    }
    // ADR-0483: the restored runtime becomes `current` again; the next upgrade repairs a failure.
    await pointCurrentNodeRuntimeAt(predecessorExecutable, input.homeDirectory).catch(
      () => undefined,
    );
    return {
      schemaVersion: 1,
      operation: "repository_node_rollback",
      planId: current.planId,
      failedRuntimeVersion: input.failedRuntimeVersion,
      predecessorRuntimeVersion: current.desired.runtimeVersion,
      service,
      readiness,
      registry,
    };
  } catch (error) {
    if (!registryCommitted) await recoverNodeFleetFailure(error, compensate, "Node rollback");
    if (error instanceof NodeFleetApplyError) throw error;
    fail("node_fleet_rollback_failed", "The repository Node rollback operation failed.", error);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
