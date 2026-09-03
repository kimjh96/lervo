import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

import { canonicalJson } from "@lervo/event-contract";
import { loadNodeRuntimeConfig, type NodeRuntimeConfig } from "@lervo/node-runtime";
import {
  type OrganizationNodeLocalRollbackApplyEvidence,
  type OrganizationNodeLocalRollbackPlanEvidence,
  type OrganizationNodeRolloutLocalRollbackPort,
} from "@lervo/organization-deployment-contract";
import {
  createNodeFleetOnboardingPlan,
  type NodeFleetOnboardingPlan,
} from "@lervo/repository-registry";

// @ts-expect-error The release-tested service renderer intentionally remains plain ESM.
import { createRuntimeServiceDefinition } from "../../../scripts/distribution/render-runtime-service.mjs";
import { applyNodeFleetRollback, type NodeFleetRollbackReceipt } from "./node-fleet-rollback.js";
import {
  inspectOrganizationRolloutExecutable,
  organizationRolloutSha256,
  type InstalledOrganizationNodeRolloutBinding,
} from "./organization-node-rollout.js";

export interface InstalledOrganizationNodeRollbackBinding extends Omit<
  InstalledOrganizationNodeRolloutBinding,
  "executablePath"
> {
  failedExecutablePath: string;
  predecessorExecutablePath: string;
}

export interface InstalledOrganizationNodeRollbackPorts {
  createPlan?: typeof createNodeFleetOnboardingPlan;
  applyRollback?: (input: {
    plan: NodeFleetOnboardingPlan;
    failedRuntimeVersion: string;
    configPath: string;
    failedExecutablePath: string;
    predecessorExecutablePath: string;
    homeDirectory?: string;
  }) => Promise<NodeFleetRollbackReceipt>;
  loadConfig?: (path: string) => Promise<NodeRuntimeConfig>;
  inspectExecutable?: (path: string) => Promise<{ path: string; artifactHash: string }>;
  renderDefinition?: typeof createRuntimeServiceDefinition;
  now?: () => Date;
}

export function createInstalledOrganizationNodeRollbackPort(
  binding: InstalledOrganizationNodeRollbackBinding,
  ports: InstalledOrganizationNodeRollbackPorts = {},
): OrganizationNodeRolloutLocalRollbackPort {
  const createPlan = ports.createPlan ?? createNodeFleetOnboardingPlan;
  const loadConfig = ports.loadConfig ?? loadNodeRuntimeConfig;
  const inspect = ports.inspectExecutable ?? inspectOrganizationRolloutExecutable;
  const renderDefinition = ports.renderDefinition ?? createRuntimeServiceDefinition;
  const applyRollback = ports.applyRollback ?? applyNodeFleetRollback;
  const now = ports.now ?? (() => new Date());

  const localPlan = async (
    input: Parameters<OrganizationNodeRolloutLocalRollbackPort["plan"]>[0],
    requireFailedState = true,
  ): Promise<{
    evidence: OrganizationNodeLocalRollbackPlanEvidence;
    plan: NodeFleetOnboardingPlan;
    failedExecutablePath: string;
    predecessorExecutablePath: string;
  }> => {
    if (
      input.enrollment.nodeId !== binding.nodeId ||
      input.enrollment.destinationId !== binding.destinationId ||
      input.predecessorRuntimeVersion !== input.enrollment.runtimeVersion ||
      input.predecessorArtifactHash !== input.enrollment.runtimeArtifactHash
    ) {
      throw new Error("The rollback predecessor does not match this installed Node enrollment.");
    }
    const [config, failedExecutable, predecessorExecutable] = await Promise.all([
      loadConfig(resolve(binding.configPath)),
      inspect(resolve(binding.failedExecutablePath)),
      inspect(resolve(binding.predecessorExecutablePath)),
    ]);
    const repositoryRoot = await realpath(resolve(binding.repositoryRoot));
    const configRoot = await realpath(config.repositoryRoot);
    if (
      configRoot !== repositoryRoot ||
      config.hub.destinationId !== binding.destinationId ||
      config.organizationCredentials?.nodeId !== binding.nodeId ||
      failedExecutable.artifactHash !== input.failedArtifactHash ||
      predecessorExecutable.artifactHash !== input.predecessorArtifactHash
    ) {
      throw new Error("The installed Node config or executable artifacts do not match rollback.");
    }
    const plan = await createPlan({
      registryPath: resolve(binding.registryPath),
      repositoryRoot,
      nodeId: binding.nodeId,
      destinationId: binding.destinationId,
      runtimeVersion: input.predecessorRuntimeVersion,
      serviceManager: binding.serviceManager,
      ...(binding.homeDirectory === undefined
        ? {}
        : { homeDirectory: resolve(binding.homeDirectory) }),
    });
    const failedDefinition = await renderDefinition({
      manager: plan.desired.serviceManager,
      runtime: "node",
      instance: plan.desired.serviceInstanceId,
      executable: failedExecutable.path,
      config: resolve(binding.configPath),
    });
    if (
      plan.desired.nodeId !== input.enrollment.nodeId ||
      plan.desired.destinationId !== input.enrollment.destinationId ||
      plan.desired.projectId !== input.enrollment.target.projectId ||
      plan.desired.repositoryIdentityHash !== input.enrollment.target.projectIdentityHash ||
      plan.desired.runtimeVersion !== input.predecessorRuntimeVersion ||
      (requireFailedState &&
        (plan.registry.reconciliation !== "refresh" ||
          plan.registry.current?.runtimeVersion !== input.failedRuntimeVersion ||
          plan.service.targetState !== "present_unverified" ||
          plan.service.targetContentHash !== organizationRolloutSha256(failedDefinition) ||
          plan.service.legacyTargetState !== "absent"))
    ) {
      throw new Error("The current local Node state is not the exact failed rollback target.");
    }
    return {
      plan,
      failedExecutablePath: failedExecutable.path,
      predecessorExecutablePath: predecessorExecutable.path,
      evidence: {
        nodeId: binding.nodeId,
        destinationId: binding.destinationId,
        projectId: input.enrollment.target.projectId,
        projectIdentityHash: input.enrollment.target.projectIdentityHash,
        failedRuntimeVersion: input.failedRuntimeVersion,
        failedArtifactHash: failedExecutable.artifactHash,
        predecessorRuntimeVersion: input.predecessorRuntimeVersion,
        predecessorArtifactHash: predecessorExecutable.artifactHash,
        localPlanId: plan.planId,
        localPlanHash: organizationRolloutSha256(canonicalJson(plan)),
      },
    };
  };

  return {
    async plan(input) {
      return structuredClone((await localPlan(input)).evidence);
    },
    async rollback({ rollbackPlan, enrollment }) {
      const current = await localPlan({
        enrollment,
        failedRuntimeVersion: rollbackPlan.failedRuntimeVersion,
        failedArtifactHash: rollbackPlan.failedArtifactHash,
        predecessorRuntimeVersion: rollbackPlan.predecessorRuntimeVersion,
        predecessorArtifactHash: rollbackPlan.predecessorArtifactHash,
      });
      if (
        current.evidence.localPlanId !== rollbackPlan.localPlanId ||
        current.evidence.localPlanHash !== rollbackPlan.localPlanHash
      ) {
        throw new Error("The installed Node rollback plan changed before local apply.");
      }
      const receipt = await applyRollback({
        plan: current.plan,
        failedRuntimeVersion: rollbackPlan.failedRuntimeVersion,
        configPath: resolve(binding.configPath),
        failedExecutablePath: current.failedExecutablePath,
        predecessorExecutablePath: current.predecessorExecutablePath,
        ...(binding.homeDirectory === undefined
          ? {}
          : { homeDirectory: resolve(binding.homeDirectory) }),
      });
      if (
        receipt.planId !== rollbackPlan.localPlanId ||
        receipt.service.change !== "rolled_back" ||
        receipt.readiness.status !== "ready" ||
        receipt.predecessorRuntimeVersion !== rollbackPlan.predecessorRuntimeVersion
      ) {
        throw new Error(
          "The installed Node rollback receipt does not prove online predecessor readiness.",
        );
      }
      const result: OrganizationNodeLocalRollbackApplyEvidence = {
        ...current.evidence,
        localApplyReceiptHash: organizationRolloutSha256(canonicalJson(receipt)),
        completedAt: now().toISOString(),
        effect: "rolled_back",
      };
      return result;
    },
    async inspectEffect({ rollbackPlan, enrollment }) {
      const current = await localPlan(
        {
          enrollment,
          failedRuntimeVersion: rollbackPlan.failedRuntimeVersion,
          failedArtifactHash: rollbackPlan.failedArtifactHash,
          predecessorRuntimeVersion: rollbackPlan.predecessorRuntimeVersion,
          predecessorArtifactHash: rollbackPlan.predecessorArtifactHash,
        },
        false,
      );
      const predecessorDefinition = await renderDefinition({
        manager: current.plan.desired.serviceManager,
        runtime: "node",
        instance: current.plan.desired.serviceInstanceId,
        executable: current.predecessorExecutablePath,
        config: resolve(binding.configPath),
      });
      const desiredHash = organizationRolloutSha256(predecessorDefinition);
      const target = current.plan.service.targetState;
      return {
        localPlanId: current.evidence.localPlanId,
        localPlanHash: current.evidence.localPlanHash,
        registry: current.plan.registry.reconciliation,
        serviceTarget:
          target === "absent"
            ? ("absent" as const)
            : target === "conflict"
              ? ("conflict" as const)
              : current.plan.service.targetContentHash === desiredHash
                ? ("desired" as const)
                : ("other" as const),
        legacyTarget: current.plan.service.legacyTargetState,
        privacy: {
          absolutePaths: "excluded" as const,
          credentials: "excluded" as const,
          serviceDefinitionBodies: "excluded" as const,
        },
      };
    },
  };
}
