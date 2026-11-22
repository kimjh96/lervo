import { randomUUID } from "node:crypto";

import {
  applyKnowledgeInstructionBridgePlan,
  canonicalJson,
  createKnowledgeInstructionBridgePlan,
  lintRepositoryKnowledge,
  serializableKnowledgeInstructionBridgePlan,
  type KnowledgeInstructionBridgePlan,
} from "@lervo/repository-knowledge";
import { lifecycleChangedPaths } from "@lervo/repository-knowledge-runtime";
import { openProjectStorage } from "@lervo/project-storage";

import { applyCrossCheckedEffect, crossCheckedEffectLines } from "./cross-checked-effect.js";
import { applyGeneratedEffect } from "./generated-effect.js";
import { collectLocalKnowledgeSources } from "./knowledge-sources.js";
import {
  instructionBridgeKnowledgeLintCodes,
  validateKnowledgeStage,
} from "./knowledge-stage-lint.js";
import type { CrossCheckPlan } from "./plan-cross-check.js";
import type { CliIo } from "./types.js";

function formatBridgePlan(plan: KnowledgeInstructionBridgePlan): string {
  if (plan.status === "current")
    return `The Claude instruction bridge matches the current profile.\nprofile: ${plan.profile.profileId}\ncanonical: ${plan.canonical.path} · ${plan.canonical.contentHash}\ntarget: ${plan.target.path} · ${plan.target.afterHash}\n`;
  if (plan.status === "ready")
    return `The Claude instruction bridge target is current; a derived record/navigation update plan was created.\nplan: ${plan.planId}\nprofile: ${plan.profile.profileId}\nUse --apply ${plan.planId} to apply.\n`;
  return `Claude instruction bridge plan created.\nplan: ${plan.planId}\nprofile: ${plan.profile.profileId}\ncanonical: ${plan.canonical.path} · ${plan.canonical.contentHash}\ntarget: ${plan.target.action} ${plan.target.path} · ${plan.target.beforeHash ?? "absent"} → ${plan.target.afterHash}\nInstructions, bridge records, concepts, and navigation have not been changed. Apply with --apply ${plan.planId}; an independent cross-check reviews it first.\n`;
}

/**
 * The Claude instruction bridge (ADR-0561). A plan that changes the user-visible bridge target is
 * cross-checked independently, applied, and committed as the undo point; a derived-only plan
 * applies directly. The background lifecycle reviewer applies the same plans on its own.
 */
export async function runInstructionBridge(input: {
  repositoryRoot: string;
  applyPlanId?: string;
  provider?: "codex" | "claude";
  json: boolean;
  io: CliIo;
  crossCheckPlan: CrossCheckPlan;
}): Promise<number> {
  const { repositoryRoot, io } = input;
  const supplementalSources = await collectLocalKnowledgeSources(repositoryRoot);
  const plan = await createKnowledgeInstructionBridgePlan({
    repositoryRoot,
    provider: "claude",
    supplementalSources,
  });
  if (input.applyPlanId === undefined) {
    io.stdout(
      input.json
        ? `${JSON.stringify(serializableKnowledgeInstructionBridgePlan(plan), null, 2)}\n`
        : formatBridgePlan(plan),
    );
    return 0;
  }
  if (plan.status === "current")
    throw new Error("The instruction bridge is already current; there are no changes to apply.");
  if (input.applyPlanId !== plan.planId)
    throw new Error("The requested plan ID does not match the current instruction bridge plan.");
  const baselineValidation = await lintRepositoryKnowledge(repositoryRoot, {
    supplementalSources,
  });
  const storage = await openProjectStorage(repositoryRoot);
  try {
    if (
      storage.events
        .list()
        .some(
          (event) =>
            event.type === "knowledge.materialization.applied" &&
            event.payload.planId === plan.planId,
        )
    )
      throw new Error("The same instruction bridge plan was already applied.");
    const identity = randomUUID().replaceAll("-", "");
    const apply = () =>
      applyKnowledgeInstructionBridgePlan({
        plan,
        // The plan's own content binding; a review_required plan applies only after agreement.
        ...(plan.status === "review_required"
          ? { approvedOperationId: plan.operationId, approvedHash: plan.approvalHash }
          : {}),
        now: new Date(),
        supplementalSources,
        recordApplied: async (applied) => {
          const observedValidation = await lintRepositoryKnowledge(repositoryRoot, {
            allowTransactionPlanId: plan.planId,
            supplementalSources,
          });
          const validation = validateKnowledgeStage({
            stage: "the instruction bridge",
            before: baselineValidation,
            after: observedValidation,
            ownedErrorCodes: instructionBridgeKnowledgeLintCodes,
          });
          const validationArtifact = await storage.artifacts.put(canonicalJson(validation));
          storage.events.append({
            eventId: `evt_${identity}`,
            projectId: plan.projectId,
            runId: `run_${identity}`,
            sessionId: `ses_${identity}`,
            type: "knowledge.materialization.applied",
            occurredAt: applied.appliedAt,
            actor: { kind: "user" },
            schemaVersion: 1,
            policyVersion: plan.policyHash,
            payload: {
              operation: "instruction_bridge_update",
              planId: plan.planId,
              sourceSnapshotId: plan.sourceSnapshotId,
              policyHash: plan.policyHash,
              compilerId: "lervo.instruction-bridge",
              compilerVersion: `${plan.profile.profileId}@${plan.profile.profileVersion}`,
              approvalDigest: plan.status === "review_required" ? plan.approvalHash : null,
              coverage: plan.coverage,
              bundleIds: [],
              createdConceptIds: plan.createdConceptIds.slice(0, 256),
              updatedConceptIds: plan.updatedConceptIds.slice(0, 256),
              deprecatedConceptIds: [],
              conceptListTruncated:
                plan.createdConceptIds.length + plan.updatedConceptIds.length > 256,
              resultArtifactId: null,
              resultArtifactHash: null,
              createdCount: plan.operations.filter((item) => item.action === "create").length,
              updatedCount: plan.operations.filter((item) => item.action === "update").length,
              unchangedCount: plan.operations.filter((item) => item.action === "unchanged").length,
              beforeRegistryDigest: plan.registryDigest,
              afterRegistryDigest: plan.afterRegistryDigest,
              validationReportId: `klint_${validationArtifact.contentHash.slice("sha256:".length, "sha256:".length + 24)}`,
              validationReportHash: validationArtifact.contentHash,
              appliedAt: applied.appliedAt,
            },
          });
        },
      });
    const { receipt, report } =
      plan.status === "review_required"
        ? await applyCrossCheckedEffect({
            crossCheckPlan: input.crossCheckPlan,
            repositoryRoot,
            ...(input.provider === undefined ? {} : { provider: input.provider }),
            plan,
            paths: lifecycleChangedPaths(plan),
            notice: {
              effect: "instruction_bridge",
              planId: plan.planId,
              reason: "reconciled the Claude instruction bridge with AGENTS.md",
            },
            apply,
          })
        : {
            // ADR-0610: a generated-only bridge refresh lands as its own commit as well.
            receipt: (
              await applyGeneratedEffect({
                repositoryRoot,
                paths: lifecycleChangedPaths(plan),
                notice: {
                  effect: "instruction_bridge",
                  planId: plan.planId,
                  reason: "refreshed the Claude instruction bridge binding",
                },
                apply,
              })
            ).receipt,
            report: null,
          };
    io.stdout(
      input.json
        ? `${JSON.stringify(report === null ? receipt : { ...receipt, notice: report }, null, 2)}\n`
        : `Applied the Claude instruction bridge and updated knowledge navigation.\nplan: ${receipt.planId}\nprofile: ${receipt.profileId}\ncanonical digest: ${receipt.canonicalPathDigest}\ntarget digest: ${receipt.targetPathDigest}\n${report === null ? "" : `${crossCheckedEffectLines(report).join("\n")}\n`}`,
    );
  } finally {
    await storage.close();
  }
  return 0;
}
