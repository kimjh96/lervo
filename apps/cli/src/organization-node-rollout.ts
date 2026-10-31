import { pinEnrolledRuntimePredecessor } from "./node-runtime-enrollment-predecessor.js";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";

import { canonicalJson } from "@lervo/event-contract";
import { loadNodeRuntimeConfig, type NodeRuntimeConfig } from "@lervo/node-runtime";
import {
  type OrganizationNodeLocalRolloutApplyEvidence,
  type OrganizationNodeLocalRolloutPlanEvidence,
  type OrganizationNodeRolloutLocalTransactionPort,
} from "@lervo/organization-deployment-contract";
import {
  createNodeFleetOnboardingPlan,
  type NodeFleetOnboardingPlan,
} from "@lervo/repository-registry";

import { applyNodeFleetOnboarding, type NodeFleetApplyReceipt } from "./node-fleet-apply.js";
// @ts-expect-error The release-tested service renderer intentionally remains plain ESM.
import { createRuntimeServiceDefinition } from "../../../scripts/distribution/render-runtime-service.mjs";

export interface InstalledOrganizationNodeRolloutBinding {
  registryPath: string;
  repositoryRoot: string;
  nodeId: string;
  destinationId: string;
  serviceManager: "systemd" | "launchd";
  configPath: string;
  executablePath: string;
  homeDirectory?: string;
}

export interface InstalledOrganizationNodeRolloutPorts {
  createPlan?: typeof createNodeFleetOnboardingPlan;
  applyPlan?: (input: {
    plan: NodeFleetOnboardingPlan;
    configPath: string;
    executablePath: string;
    homeDirectory?: string;
  }) => Promise<NodeFleetApplyReceipt>;
  loadConfig?: (path: string) => Promise<NodeRuntimeConfig>;
  inspectExecutable?: (path: string) => Promise<{ path: string; artifactHash: string }>;
  now?: () => Date;
}

export function organizationRolloutSha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export async function inspectOrganizationRolloutExecutable(
  path: string,
): Promise<{ path: string; artifactHash: string }> {
  const absolute = resolve(path);
  const metadata = await lstat(absolute);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1) {
    throw new Error("The rollout executable must be a real non-empty file.");
  }
  const physical = await realpath(absolute);
  return { path: physical, artifactHash: organizationRolloutSha256(await readFile(physical)) };
}

export function createInstalledOrganizationNodeRolloutPort(
  binding: InstalledOrganizationNodeRolloutBinding,
  ports: InstalledOrganizationNodeRolloutPorts = {},
): OrganizationNodeRolloutLocalTransactionPort {
  const createPlan = ports.createPlan ?? createNodeFleetOnboardingPlan;
  const loadConfig = ports.loadConfig ?? loadNodeRuntimeConfig;
  const inspect = ports.inspectExecutable ?? inspectOrganizationRolloutExecutable;
  const applyPlan =
    ports.applyPlan ??
    (async (input) =>
      applyNodeFleetOnboarding({
        plan: input.plan,
        configPath: input.configPath,
        ports: { executablePath: input.executablePath },
        ...(input.homeDirectory === undefined ? {} : { homeDirectory: input.homeDirectory }),
      }));
  const now = ports.now ?? (() => new Date());

  const localPlan = async (input: {
    enrollment: Parameters<OrganizationNodeRolloutLocalTransactionPort["plan"]>[0]["enrollment"];
    targetRuntimeVersion: string;
    targetArtifactHash: string;
  }): Promise<{
    evidence: OrganizationNodeLocalRolloutPlanEvidence;
    plan: NodeFleetOnboardingPlan;
    executablePath: string;
  }> => {
    if (
      input.enrollment.nodeId !== binding.nodeId ||
      input.enrollment.destinationId !== binding.destinationId ||
      input.enrollment.target.projectId === ""
    ) {
      throw new Error("The rollout enrollment does not match this installed Node binding.");
    }
    const [config, executable] = await Promise.all([
      loadConfig(resolve(binding.configPath)),
      inspect(resolve(binding.executablePath)),
    ]);
    const repositoryRoot = await realpath(resolve(binding.repositoryRoot));
    const configRoot = await realpath(config.repositoryRoot);
    if (
      configRoot !== repositoryRoot ||
      config.hub.destinationId !== binding.destinationId ||
      config.organizationCredentials?.nodeId !== binding.nodeId ||
      executable.artifactHash !== input.targetArtifactHash
    ) {
      throw new Error(
        "The installed Node config or executable does not match the organization rollout target.",
      );
    }
    const plan = await createPlan({
      registryPath: resolve(binding.registryPath),
      repositoryRoot,
      nodeId: binding.nodeId,
      destinationId: binding.destinationId,
      runtimeVersion: input.targetRuntimeVersion,
      serviceManager: binding.serviceManager,
      ...(binding.homeDirectory === undefined
        ? {}
        : { homeDirectory: resolve(binding.homeDirectory) }),
    });
    if (
      plan.desired.nodeId !== input.enrollment.nodeId ||
      plan.desired.destinationId !== input.enrollment.destinationId ||
      plan.desired.projectId !== input.enrollment.target.projectId ||
      plan.desired.repositoryIdentityHash !== input.enrollment.target.projectIdentityHash ||
      plan.desired.runtimeVersion !== input.targetRuntimeVersion
    ) {
      throw new Error("The current local Node plan does not match the rollout enrollment.");
    }
    return {
      plan,
      executablePath: executable.path,
      evidence: {
        nodeId: binding.nodeId,
        destinationId: binding.destinationId,
        projectId: input.enrollment.target.projectId,
        projectIdentityHash: input.enrollment.target.projectIdentityHash,
        targetRuntimeVersion: input.targetRuntimeVersion,
        targetArtifactHash: executable.artifactHash,
        localPlanId: plan.planId,
        localPlanHash: organizationRolloutSha256(canonicalJson(plan)),
      },
    };
  };

  return {
    async plan(input) {
      return structuredClone((await localPlan(input)).evidence);
    },
    async apply({ executionPlan, enrollment }) {
      const current = await localPlan({
        enrollment,
        targetRuntimeVersion: executionPlan.targetRuntimeVersion,
        targetArtifactHash: executionPlan.targetArtifactHash,
      });
      if (
        current.evidence.localPlanId !== executionPlan.localPlanId ||
        current.evidence.localPlanHash !== executionPlan.localPlanHash
      ) {
        throw new Error("The installed Node plan changed before local apply.");
      }
      if (ports.applyPlan === undefined)
        await pinEnrolledRuntimePredecessor({
          enrollmentId: enrollment.enrollmentId,
          artifactHash: enrollment.runtimeArtifactHash,
          ...(binding.homeDirectory === undefined ? {} : { homeDirectory: binding.homeDirectory }),
        });
      const receipt = await applyPlan({
        plan: current.plan,
        configPath: resolve(binding.configPath),
        executablePath: current.executablePath,
        ...(binding.homeDirectory === undefined
          ? {}
          : { homeDirectory: resolve(binding.homeDirectory) }),
      });
      if (receipt.planId !== executionPlan.localPlanId || receipt.readiness.status !== "ready") {
        throw new Error("The installed Node apply receipt does not prove online readiness.");
      }
      const result: OrganizationNodeLocalRolloutApplyEvidence = {
        ...current.evidence,
        localApplyReceiptHash: organizationRolloutSha256(canonicalJson(receipt)),
        completedAt: now().toISOString(),
        effect: "applied",
      };
      return result;
    },
    async inspectEffect({ executionPlan, enrollment }) {
      const current = await localPlan({
        enrollment,
        targetRuntimeVersion: executionPlan.targetRuntimeVersion,
        targetArtifactHash: executionPlan.targetArtifactHash,
      });
      const definition = await createRuntimeServiceDefinition({
        manager: current.plan.desired.serviceManager,
        runtime: "node",
        instance: current.plan.desired.serviceInstanceId,
        executable: current.executablePath,
        config: resolve(binding.configPath),
      });
      const desiredHash = organizationRolloutSha256(definition);
      const observedTarget = current.plan.service.targetState;
      const serviceTarget =
        observedTarget === "absent"
          ? ("absent" as const)
          : observedTarget === "conflict"
            ? ("conflict" as const)
            : current.plan.service.targetContentHash === desiredHash
              ? ("desired" as const)
              : ("other" as const);
      return {
        localPlanId: current.evidence.localPlanId,
        localPlanHash: current.evidence.localPlanHash,
        registry: current.plan.registry.reconciliation,
        serviceTarget,
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
