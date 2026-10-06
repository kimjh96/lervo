import { applyCapabilityMigration, createCapabilityMigrationPlan } from "@lervo/capabilities";
import { applyWorkforceRoleBindingMigration } from "@lervo/agent-workforce";

import { applyEventWriterStage } from "./event-writer-activation-stage.js";
import { applyHostResidentService } from "./knowledge-host-service.js";
import {
  applyRepositoryReplicaService,
  inspectRepositoryReplicaService,
} from "./repository-replica-service.js";
import { applyTerminalIntegrationStage } from "./terminal-integration-stage.js";
import type { UpgradeReceipt } from "./upgrade-format.js";
import { applyRegisteredNodeUpgrade, inspectRegisteredNodeUpgrade } from "./upgrade-node.js";
import { createRepositoryUpgradePlan, type RepositoryUpgradePlan } from "./upgrade-plan.js";
import {
  applyKnowledgeStage,
  inspectKnowledge,
  inspectTerminalIntegration,
  inspectWorkforce,
  lintKnowledge,
  type UpgradeStageBlocker,
} from "./upgrade-stage-inspection.js";
import {
  deferralReason,
  deferringPrerequisite,
  type StageDisposition,
  type UpgradeStageName,
} from "./upgrade-stage-policy.js";
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

/** Applies an exact, freshly recreated upgrade plan stage by stage in the published order. */
export async function applyRepositoryUpgrade(
  approved: RepositoryUpgradePlan,
  roleBindingApprovals: Array<{ operationId: string; approvalHash: string }>,
): Promise<UpgradeReceipt> {
  const root = approved.repositoryRoot;
  const appliedStages: string[] = [];
  const skippedStages: UpgradeReceipt["skippedStages"] = [];

  if (approved.stages.capabilities.disposition === "safe_apply") {
    const capabilityPlan = await createCapabilityMigrationPlan(root);
    if (capabilityPlan.planId !== approved.stages.capabilities.planId)
      throw new Error("The capability migration plan changed before apply.");
    await applyCapabilityMigration(capabilityPlan);
    appliedStages.push("capabilities");
  }

  const workforce = await inspectWorkforce(root);
  if (workforce.disposition === "blocked")
    skippedStages.push({ stage: "workforce", reason: workforce.reason });
  else if (
    workforce.disposition === "safe_apply" ||
    workforce.disposition === "pending_authority"
  ) {
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

  if (approved.stages.terminalIntegration.disposition === "safe_apply") {
    const terminal = await inspectTerminalIntegration(root);
    if (terminal.stage.planId !== approved.stages.terminalIntegration.planId)
      throw new Error("The terminal integration plan changed before apply.");
    await applyTerminalIntegrationStage({
      repositoryRoot: root,
      prepared: terminal.prepared,
      approval: null,
      now: new Date(),
    });
    appliedStages.push("terminal_integration");
  }

  for (let index = 0; index < approved.policy.maximumKnowledgeStages; index += 1) {
    const stage = await inspectKnowledge(root);
    if (stage.disposition !== "safe_apply") break;
    await applyKnowledgeStage(root, stage);
    appliedStages.push(stage.planKind);
    if (index === approved.policy.maximumKnowledgeStages - 1)
      throw new Error(
        "The bounded knowledge upgrade did not converge within 16 generated-only stages.",
      );
  }

  const postKnowledge = await inspectKnowledge(root);
  let lint: UpgradeReceipt["knowledgeLint"] = null;
  const nodeDeferral = deferringPrerequisite("node", { knowledge: postKnowledge.disposition });
  if (nodeDeferral !== null) {
    skippedStages.push({ stage: "knowledge_lint", reason: deferralReason(nodeDeferral) });
    skippedStages.push({ stage: "node", reason: deferralReason(nodeDeferral) });
  } else {
    lint = await lintKnowledge(root);
    const node = await inspectRegisteredNodeUpgrade(root, approved.projectId, approved.cli.version);
    if (node.stage.disposition === "safe_apply") {
      await applyRegisteredNodeUpgrade(node);
      appliedStages.push("repository_node");
    }
  }

  // The event writer stage re-observes the hook reader and the Node and Hub readers itself, so a
  // stage deferred behind them applies once they are current and is skipped otherwise.
  const eventWriter = approved.stages.eventWriter;
  if (eventWriter.disposition === "safe_apply" || eventWriter.disposition === "deferred") {
    const outcome = await applyEventWriterStage(root, eventWriter);
    if (outcome.status === "activated") appliedStages.push("event_writer");
    else if (outcome.status === "skipped")
      skippedStages.push({
        stage: "event_writer",
        reason: outcome.stage.blockers[0]?.code ?? outcome.stage.reason,
      });
  }

  if (approved.stages.hostService.disposition === "safe_apply") {
    const service = await applyHostResidentService(approved.stages.hostService);
    if (service !== null) appliedStages.push("host_service");
  }

  // ADR-0483: a stage deferred behind the Node stage is re-observed, because an activated Node
  // already moved `current`; an approved stage is applied against its exact plan.
  const replicaStage =
    approved.stages.replicaService.disposition === "deferred"
      ? await inspectRepositoryReplicaService()
      : approved.stages.replicaService;
  if (
    replicaStage.disposition === "safe_apply" &&
    (await applyRepositoryReplicaService(replicaStage)) !== null
  )
    appliedStages.push("replica_service");

  const final = await createRepositoryUpgradePlan(root);
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
  };
}
