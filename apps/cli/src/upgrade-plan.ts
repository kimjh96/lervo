import { planNodeRuntimeRetention, type RuntimeRetentionPlan } from "./node-runtime-retention.js";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createCapabilityMigrationPlan } from "@lervo/capabilities";
import { loadProjectManifest } from "@lervo/project";

import {
  inspectEventWriterStage,
  TARGET_EVENT_SCHEMA_VERSION,
  type EventWriterStage,
} from "./event-writer-activation-stage.js";
import {
  inspectHostResidentService,
  type HostResidentServiceStage,
} from "./knowledge-host-service.js";
import {
  inspectRepositoryReplicaService,
  type RepositoryReplicaServiceStage,
} from "./repository-replica-service.js";
import { upgradeHost, type UpgradeHost } from "./upgrade-host.js";
import { inspectRegisteredNodeUpgrade, type NodeUpgradeStage } from "./upgrade-node.js";
import {
  inspectKnowledge,
  inspectTerminalIntegration,
  inspectWorkforce,
  type KnowledgeStage,
  type TerminalIntegrationStage,
  type WorkforceStage,
} from "./upgrade-stage-inspection.js";
import {
  applicableUpgradeStages,
  deferralReason,
  deferringPrerequisite,
  overallUpgradeStatus,
  upgradeStageDependencies,
  type StageDisposition,
  type UpgradeStageName,
} from "./upgrade-stage-policy.js";
import { readCliPackageVersion } from "./version-command.js";

export interface RepositoryUpgradePlan {
  schemaVersion: 1;
  planKind: "repository_upgrade";
  planId: string;
  repositoryRoot: string;
  projectId: string;
  status: "ready" | "current" | "pending_authority" | "blocked";
  /** Stages an exact apply of this plan changes, even when another stage is blocked. */
  applicableStages: UpgradeStageName[];
  cli: { version: string; buildHash: string; acquisition: "outside_repository_upgrade" };
  policy: {
    generatedOnlyAutomaticApply: true;
    maximumKnowledgeStages: 16;
    userOwnedBytes: "exact_approval_required";
    providerConfiguration: "exact_approval_required";
    nodeService: "registered_instance_transactional_reconciliation";
    eventWriter: "backup_then_exact_event_contract_plan";
    hostService: "one_user_service_for_unserved_repositories";
    replicaService: "current_runtime_pointer_and_managed_coordinator";
    stageDependencies: typeof upgradeStageDependencies;
  };
  stages: {
    runtimeRetention: RuntimeRetentionPlan;
    capabilities: {
      disposition: StageDisposition;
      planId: string;
      createCount: number;
      observedProviderSurfaceCount: number;
    };
    workforce: WorkforceStage;
    terminalIntegration: TerminalIntegrationStage;
    knowledge: KnowledgeStage;
    node: Omit<NodeUpgradeStage, "disposition"> & { disposition: StageDisposition };
    eventWriter: EventWriterStage;
    hostService: HostResidentServiceStage;
    replicaService: RepositoryReplicaServiceStage;
  };
  privacy: {
    scope: "local_plan_and_receipt";
    credentials: "excluded";
    providerContent: "excluded";
    absolutePaths: "repository_root_only";
  };
  failureMeaning: string;
}

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function planIdentifier(value: unknown): string {
  return `upg_${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24)}`;
}

async function cliBuildHash(): Promise<string> {
  return sha256(await readFile(fileURLToPath(import.meta.url)));
}

function deferredWorkforce(reason: string): WorkforceStage {
  return {
    disposition: "deferred",
    planId: null,
    staleAgentCount: 0,
    staleAssignmentCount: 0,
    status: "deferred",
    reason,
    requiredApprovals: [],
  };
}

function deferredKnowledge(reason: string): KnowledgeStage {
  return {
    disposition: "deferred",
    planKind: "knowledge_migration",
    planId: null,
    status: "deferred",
    reason,
    blockers: [],
  };
}

/**
 * A deferred event writer stage keeps its reason; apply re-observes it after the hook runtime
 * and Node stages, so the plan binds no reader observation for it.
 */
async function eventWriterStage(
  repositoryRoot: string,
  dispositions: Partial<Record<UpgradeStageName, StageDisposition>>,
  host: UpgradeHost,
): Promise<EventWriterStage> {
  const deferral = deferringPrerequisite("event_writer", dispositions);
  const inspected = await inspectEventWriterStage(repositoryRoot, host.eventWriter);
  if (deferral === null || inspected.disposition === "current") return inspected;
  return {
    ...inspected,
    disposition: "deferred",
    reason: deferralReason(deferral),
    targetSchemaVersion: TARGET_EVENT_SCHEMA_VERSION,
    authority: null,
    observationHash: null,
    blockers: [],
  };
}

/**
 * A knowledge stage blocked only because a materialization marker existed. The foreground
 * settlement waits for a live owner and plans again; an interrupted marker refuses before this.
 */
export function knowledgeStageRefusedByMarker(
  plan: Pick<RepositoryUpgradePlan, "stages">,
): boolean {
  return plan.stages.knowledge.reason === "knowledge_recovery_required";
}

export async function createRepositoryUpgradePlan(
  root: string,
  host: UpgradeHost = upgradeHost(),
): Promise<RepositoryUpgradePlan> {
  const repositoryRoot = await realpath(resolve(root));
  const project = await loadProjectManifest(repositoryRoot);
  const version = readCliPackageVersion();
  const capabilities = await createCapabilityMigrationPlan(repositoryRoot);
  const capabilityDisposition: StageDisposition =
    capabilities.status === "ready" ? "safe_apply" : "current";
  const capabilityGate = { capabilities: capabilityDisposition };
  const workforceDeferral = deferringPrerequisite("workforce", capabilityGate);
  const knowledgeDeferral = deferringPrerequisite("knowledge", capabilityGate);
  const [buildHash, workforce, terminal, knowledge, node, hostService, replica] = await Promise.all(
    [
      cliBuildHash(),
      workforceDeferral === null
        ? inspectWorkforce(repositoryRoot)
        : Promise.resolve(deferredWorkforce(deferralReason(workforceDeferral))),
      inspectTerminalIntegration(repositoryRoot),
      knowledgeDeferral === null
        ? inspectKnowledge(repositoryRoot)
        : Promise.resolve(deferredKnowledge(deferralReason(knowledgeDeferral))),
      inspectRegisteredNodeUpgrade(
        repositoryRoot,
        project.projectId,
        version,
        host.describeNodeLauncher,
      ),
      inspectHostResidentService(host.hostService),
      inspectRepositoryReplicaService(host.replicaService),
    ],
  );
  const nodeDeferral = deferringPrerequisite("node", { knowledge: knowledge.disposition });
  const nodeStage: RepositoryUpgradePlan["stages"]["node"] =
    nodeDeferral === null || node.stage.disposition !== "safe_apply"
      ? node.stage
      : { ...node.stage, disposition: "deferred", reason: deferralReason(nodeDeferral) };
  const replicaDeferral = deferringPrerequisite("replica_service", {
    node: nodeStage.disposition,
  });
  const replicaService: RepositoryReplicaServiceStage =
    replicaDeferral === null || replica.disposition !== "safe_apply"
      ? replica
      : { ...replica, disposition: "deferred", reason: deferralReason(replicaDeferral) };
  const eventWriter = await eventWriterStage(
    repositoryRoot,
    {
      terminal_integration: terminal.stage.disposition,
      node: nodeStage.disposition,
    },
    host,
  );
  const runtimeRetention = await planNodeRuntimeRetention(host.runtimeRetention);
  const dispositions: Record<UpgradeStageName, StageDisposition> = {
    runtime_retention: runtimeRetention.disposition,
    capabilities: capabilityDisposition,
    workforce: workforce.disposition,
    terminal_integration: terminal.stage.disposition,
    knowledge: knowledge.disposition,
    node: nodeStage.disposition,
    event_writer: eventWriter.disposition,
    host_service: hostService.disposition,
    replica_service: replicaService.disposition,
  };
  const body = {
    schemaVersion: 1 as const,
    planKind: "repository_upgrade" as const,
    repositoryRoot,
    projectId: project.projectId,
    status: overallUpgradeStatus(Object.values(dispositions)),
    applicableStages: applicableUpgradeStages(dispositions, workforce.requiredApprovals.length > 0),
    cli: { version, buildHash, acquisition: "outside_repository_upgrade" as const },
    policy: {
      generatedOnlyAutomaticApply: true as const,
      maximumKnowledgeStages: 16 as const,
      userOwnedBytes: "exact_approval_required" as const,
      providerConfiguration: "exact_approval_required" as const,
      nodeService: "registered_instance_transactional_reconciliation" as const,
      eventWriter: "backup_then_exact_event_contract_plan" as const,
      hostService: "one_user_service_for_unserved_repositories" as const,
      replicaService: "current_runtime_pointer_and_managed_coordinator" as const,
      stageDependencies: upgradeStageDependencies,
    },
    stages: {
      runtimeRetention,
      capabilities: {
        disposition: capabilityDisposition,
        planId: capabilities.planId,
        createCount: capabilities.items.filter((item) => item.action === "create").length,
        observedProviderSurfaceCount: capabilities.observedProviderSurfaces.length,
      },
      workforce,
      terminalIntegration: terminal.stage,
      knowledge,
      node: nodeStage,
      eventWriter,
      hostService,
      replicaService,
    },
    privacy: {
      scope: "local_plan_and_receipt" as const,
      credentials: "excluded" as const,
      providerContent: "excluded" as const,
      absolutePaths: "repository_root_only" as const,
    },
    failureMeaning:
      "A non-current stage is not proof of migration, provider activation, Node readiness, event writer activation, host service readiness, or CLI acquisition. A blocked stage does not prevent applying independent generated-only stages.",
  };
  return { ...body, planId: planIdentifier(body) };
}
