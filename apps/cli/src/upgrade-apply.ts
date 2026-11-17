import { applyNodeRuntimeRetention } from "./node-runtime-retention.js";
import { rememberTerminalWorkerEntry } from "./terminal-worker-entry.js";
import { applyCapabilityMigration, createCapabilityMigrationPlan } from "@lervo/capabilities";
import { applyWorkforceRoleBindingMigration } from "@lervo/agent-workforce";
import type { KnowledgeMaterializationSettlement } from "@lervo/repository-knowledge";

import { applyEventWriterStage } from "./event-writer-activation-stage.js";
import { applyHostResidentService } from "./knowledge-host-service.js";
import {
  applyRepositoryReplicaService,
  inspectRepositoryReplicaService,
} from "./repository-replica-service.js";
import { applyTerminalIntegrationStage } from "./terminal-integration-stage.js";
import type { UpgradeReceipt } from "./upgrade-format.js";
import type { UpgradeHost } from "./upgrade-host.js";
import { applyRegisteredNodeUpgrade, inspectRegisteredNodeUpgrade } from "./upgrade-node.js";
import {
  createRepositoryUpgradePlan,
  knowledgeStageRefusedByMarker,
  type RepositoryUpgradePlan,
} from "./upgrade-plan.js";
import type { UpgradeResidentExclusion } from "./upgrade-resident-exclusion.js";
import {
  applyKnowledgeStage,
  inspectKnowledge,
  inspectTerminalIntegration,
  inspectWorkforce,
  lintKnowledge,
  type KnowledgeStage,
  type UpgradeStageBlocker,
} from "./upgrade-stage-inspection.js";
import { type StageDisposition, type UpgradeStageName } from "./upgrade-stage-policy.js";
import type { UpgradeStageClock } from "./upgrade-stage-timing.js";
import { mutateWorkforceState } from "./workforce-mutation.js";

export function pendingStages(plan: RepositoryUpgradePlan): UpgradeReceipt["pending"] {
  const stages: Array<{
    stage: UpgradeStageName;
    disposition: StageDisposition;
    reason: string;
    blockers?: UpgradeStageBlocker[];
  }> = [
    {
      stage: "capabilities",
      disposition: plan.stages.capabilities.disposition,
      reason: "capability_migration_pending",
    },
    { stage: "workforce", ...plan.stages.workforce },
    { stage: "terminal_integration", ...plan.stages.terminalIntegration },
    { stage: "knowledge", ...plan.stages.knowledge },
    { stage: "node", ...plan.stages.node },
    { stage: "event_writer", ...plan.stages.eventWriter },
    { stage: "host_service", ...plan.stages.hostService },
    { stage: "replica_service", ...plan.stages.replicaService },
  ];
  return stages
    .filter((stage) => stage.disposition === "pending_authority" || stage.disposition === "blocked")
    .map((stage) => ({
      stage: stage.stage,
      disposition: stage.disposition,
      reason: stage.reason,
      blockers: stage.blockers ?? [],
    }));
}

const knowledgeRefusedByMarker = (stage: KnowledgeStage): boolean =>
  stage.reason === "knowledge_recovery_required";

/**
 * Applies an exact, freshly recreated upgrade plan stage by stage in the published order. Every
 * knowledge step runs through the command's materialization settlement, so background knowledge
 * work that starts between stages delays the upgrade instead of failing it. ADR-0577: every stage
 * that changes the repository or a service first confirms the resident exclusion.
 */
export async function applyRepositoryUpgrade(
  approved: RepositoryUpgradePlan,
  roleBindingApprovals: Array<{ operationId: string; approvalHash: string }>,
  materialization: KnowledgeMaterializationSettlement,
  host: UpgradeHost,
  exclusion: UpgradeResidentExclusion,
  clock: UpgradeStageClock,
): Promise<UpgradeReceipt> {
  const root = approved.repositoryRoot;
  const appliedStages: string[] = [];
  const skippedStages: UpgradeReceipt["skippedStages"] = [];
  const confirmExclusion = (nextStage: UpgradeStageName | "terminal_worker_entry" | null) =>
    exclusion.assertHeld({ nextStage, appliedStages });
  await confirmExclusion("terminal_worker_entry");
  await rememberTerminalWorkerEntry(root, process.env.LERVO_CLI_ENTRY);

  if (approved.stages.capabilities.disposition === "safe_apply") {
    const capabilityPlan = await createCapabilityMigrationPlan(root);
    if (capabilityPlan.planId !== approved.stages.capabilities.planId)
      throw new Error("The capability migration plan changed before apply.");
    await confirmExclusion("capabilities");
    await applyCapabilityMigration(capabilityPlan);
    appliedStages.push("capabilities");
  }
  clock.lap("capabilities");

  const workforce = await inspectWorkforce(root);
  if (workforce.disposition === "blocked")
    skippedStages.push({ stage: "workforce", reason: workforce.reason });
  else if (
    workforce.disposition === "safe_apply" ||
    workforce.disposition === "pending_authority"
  ) {
    await confirmExclusion("workforce");
    const migrated = await mutateWorkforceState(root, (recordEvent) =>
      applyWorkforceRoleBindingMigration({
        repositoryRoot: root,
        approval: workforce.planId!,
        approvedRoleBindings: roleBindingApprovals,
        recordEvent,
      }),
    );
    if (migrated.migratedAgentCount + migrated.migratedAssignmentCount > 0)
      appliedStages.push("workforce_role_bindings");
  }
  clock.lap("workforce");

  if (approved.stages.terminalIntegration.disposition === "safe_apply") {
    const terminal = await inspectTerminalIntegration(root);
    if (terminal.stage.planId !== approved.stages.terminalIntegration.planId)
      throw new Error("The terminal integration plan changed before apply.");
    await confirmExclusion("terminal_integration");
    await applyTerminalIntegrationStage({
      repositoryRoot: root,
      prepared: terminal.prepared,
      approval: null,
      now: new Date(),
    });
    appliedStages.push("terminal_integration");
  }
  clock.lap("terminal_integration");

  // ADR-0578: the approved plan inspected knowledge inside this exclusion. When no stage wrote
  // since and that inspection left nothing to apply, it still holds, so it is not repeated. A
  // generated-only stage is inspected again right before its apply, as before.
  let unchangedSincePlan =
    appliedStages.length === 0 &&
    ["current", "pending_authority", "blocked"].includes(approved.stages.knowledge.disposition);
  for (let index = 0; index < approved.policy.maximumKnowledgeStages; index += 1) {
    // A marker refusal happens before any write, so inspecting and applying again is safe.
    const stage = await materialization.run(async () => {
      const inspected = unchangedSincePlan
        ? approved.stages.knowledge
        : await inspectKnowledge(root);
      unchangedSincePlan = false;
      if (inspected.disposition === "safe_apply") {
        await confirmExclusion("knowledge");
        await applyKnowledgeStage(root, inspected);
      }
      return inspected;
    }, knowledgeRefusedByMarker);
    clock.lap("knowledge");
    if (stage.disposition !== "safe_apply") break;
    appliedStages.push(stage.planKind);
    if (index === approved.policy.maximumKnowledgeStages - 1)
      throw new Error(
        "The bounded knowledge upgrade did not converge within 16 generated-only stages.",
      );
  }

  // ADR-0546: the Node stage is ordered after knowledge without depending on it, and lint reports
  // a blocked knowledge stage instead of being skipped.
  const node = await inspectRegisteredNodeUpgrade(
    root,
    approved.projectId,
    approved.cli.version,
    host.describeNodeLauncher,
  );
  clock.lap("node_inspection");
  if (node.stage.disposition === "safe_apply") {
    await confirmExclusion("node");
    const onboarding = await applyRegisteredNodeUpgrade(node, host.describeNodeLauncher);
    clock.lapNode(onboarding?.timing);
    appliedStages.push("repository_node");
  }
  const lint: UpgradeReceipt["knowledgeLint"] = await materialization.run(() =>
    lintKnowledge(root),
  );
  clock.lap("knowledge_lint");

  // The event writer stage re-observes the hook reader and the Node and Hub readers itself, so a
  // stage deferred behind them applies once they are current and is skipped otherwise.
  const eventWriter = approved.stages.eventWriter;
  if (eventWriter.disposition === "safe_apply" || eventWriter.disposition === "deferred") {
    await confirmExclusion("event_writer");
    const outcome = await applyEventWriterStage(root, eventWriter, host.eventWriter);
    if (outcome.status === "activated") appliedStages.push("event_writer");
    else if (outcome.status === "skipped")
      skippedStages.push({
        stage: "event_writer",
        reason: outcome.stage.blockers[0]?.code ?? outcome.stage.reason,
      });
  }
  clock.lap("event_writer");

  if (approved.stages.hostService.disposition === "safe_apply") {
    await confirmExclusion("host_service");
    const service = await applyHostResidentService(approved.stages.hostService, host.hostService);
    if (service !== null) appliedStages.push("host_service");
  }
  clock.lap("host_service");

  // ADR-0483: a stage deferred behind the Node stage is re-observed, because an activated Node
  // already moved `current`; an approved stage is applied against its exact plan.
  const replicaStage =
    approved.stages.replicaService.disposition === "deferred"
      ? await inspectRepositoryReplicaService(host.replicaService)
      : approved.stages.replicaService;
  if (replicaStage.disposition === "safe_apply") {
    await confirmExclusion("replica_service");
    if ((await applyRepositoryReplicaService(replicaStage, host.replicaService)) !== null)
      appliedStages.push("replica_service");
  }
  clock.lap("replica_service");

  await confirmExclusion("runtime_retention");
  if (await applyNodeRuntimeRetention(approved.stages.runtimeRetention, host.runtimeRetention))
    appliedStages.push("runtime_retention");
  // A holder that still holds was never replaced, so every stage ran under the exclusion.
  await confirmExclusion(null);
  clock.lap("runtime_retention");

  const final = await materialization.run(
    () => createRepositoryUpgradePlan(root, host),
    knowledgeStageRefusedByMarker,
  );
  clock.lap("final_plan");
  return {
    schemaVersion: 1,
    operation: "repository_upgrade",
    approvedPlanId: approved.planId,
    status: final.status,
    appliedStages,
    skippedStages,
    knowledgeLint: lint,
    nextPlanId: final.status === "current" ? null : final.planId,
    pending: pendingStages(final),
    cliAcquisition: "outside_repository_upgrade",
    stageTimings: clock.timings,
  };
}
