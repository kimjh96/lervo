import { randomUUID } from "node:crypto";

import {
  applyRepositoryLayoutMigrationPlan,
  canonicalJson,
  lintRepositoryKnowledge,
  repositoryLayoutItemBindings,
  serializableRepositoryLayoutMigrationPlan,
  sha256,
  type RepositoryLayoutMigrationPlan,
  type RepositoryLayoutMigrationReceipt,
  type RepositorySupplementalSource,
} from "@lervo/repository-knowledge";
import { lifecycleChangedPaths } from "@lervo/repository-knowledge-runtime";
import { openProjectStorage } from "@lervo/project-storage";
import type { ProjectStorage } from "@lervo/project-storage";

import { applyCrossCheckedEffect, crossCheckedEffectLines } from "./cross-checked-effect.js";
import { migrationDeferralOutput } from "./knowledge-migration-deferrals.js";
import { formatRepositoryLayoutMigrationPlan } from "./knowledge-migration-format.js";
import {
  expectedInstructionBridgeTransitions,
  repositoryLayoutKnowledgeLintCodes,
  validateKnowledgeStage,
} from "./knowledge-stage-lint.js";
import type { CrossCheckPlan } from "./plan-cross-check.js";
import type { CliIo } from "./types.js";

/** The materialization event of an applied layout plan, with its stage validation. */
async function recordLayoutMaterialization(input: {
  storage: ProjectStorage;
  layout: RepositoryLayoutMigrationPlan;
  applied: RepositoryLayoutMigrationReceipt;
  baselineValidation: Awaited<ReturnType<typeof lintRepositoryKnowledge>>;
  supplementalSources: RepositorySupplementalSource[];
  eventIdentity: string;
}): Promise<void> {
  const { layout, applied, storage } = input;
  const observedValidation = await lintRepositoryKnowledge(layout.repositoryRoot, {
    allowTransactionPlanId: layout.planId,
    supplementalSources: input.supplementalSources,
  });
  const validation = validateKnowledgeStage({
    stage: "repository layout migration",
    before: input.baselineValidation,
    after: observedValidation,
    ownedErrorCodes: repositoryLayoutKnowledgeLintCodes,
    expectedTransitionCodes: expectedInstructionBridgeTransitions(layout.operations),
  });
  const validationHash = sha256(canonicalJson(validation));
  await storage.artifacts.put(canonicalJson(validation));
  const conceptChanges = layout.operations
    .map((operation) => ({
      operation,
      match: /^\.lervo\/knowledge\/concepts\/(?:[a-f0-9]{2}\/)?(concept_[a-f0-9]{24})\.yaml$/.exec(
        operation.path,
      ),
    }))
    .filter(
      (
        item,
      ): item is {
        operation: (typeof layout.operations)[number];
        match: RegExpExecArray;
      } => item.match !== null,
    );
  const conceptIds = (action: string) =>
    conceptChanges
      .filter((item) => item.operation.action === action)
      .map((item) => item.match[1] as string)
      .slice(0, 256);
  storage.events.append({
    eventId: `evt_${input.eventIdentity}`,
    projectId: layout.projectId,
    runId: `run_${input.eventIdentity}`,
    sessionId: `ses_${input.eventIdentity}`,
    type: "knowledge.materialization.applied",
    occurredAt: applied.appliedAt,
    actor: { kind: "system" },
    schemaVersion: 1,
    policyVersion: layout.policyHash,
    payload: {
      operation: "migrate",
      planId: applied.planId,
      sourceSnapshotId: applied.sourceSnapshotId,
      policyHash: layout.policyHash,
      compilerId: "lervo.repository-layout",
      compilerVersion: "1",
      approvalDigest: applied.approvalDigest,
      coverage: layout.coverage,
      bundleIds: [],
      createdConceptIds: conceptIds("create"),
      updatedConceptIds: conceptIds("update"),
      deprecatedConceptIds: [],
      conceptListTruncated: conceptChanges.length > 256,
      resultArtifactId: null,
      resultArtifactHash: null,
      createdCount: applied.created.length,
      updatedCount: applied.updated.length,
      unchangedCount: applied.unchanged.length,
      beforeRegistryDigest: layout.registryDigest,
      afterRegistryDigest: sha256(
        canonicalJson(
          layout.operations.map((item) => ({
            pathDigest: sha256(item.path),
            hash: item.action === "move" ? item.expectedCurrentHash : item.desiredHash,
          })),
        ),
      ),
      validationReportId: `klint_${validationHash.slice("sha256:".length, "sha256:".length + 24)}`,
      validationReportHash: validationHash,
      appliedAt: applied.appliedAt,
    },
  });
}

/**
 * The repository layout stage of `lervo migrate knowledge` (ADR-0561). A plan that moves or
 * updates user documents is cross-checked independently, applied whole, and committed as the undo
 * point; a plan of generated moves applies directly. Without `--apply` the plan is shown and the
 * background lifecycle reviewer applies it on its own, whatever the delegation's roots.
 */
export async function runRepositoryLayoutStage(input: {
  repositoryRoot: string;
  layout: RepositoryLayoutMigrationPlan;
  supplementalSources: RepositorySupplementalSource[];
  applyPlanId?: string;
  provider?: "codex" | "claude";
  json: boolean;
  io: CliIo;
  crossCheckPlan: CrossCheckPlan;
}): Promise<number> {
  const { layout, io } = input;
  if (input.applyPlanId === undefined) {
    io.stdout(
      input.json
        ? `${JSON.stringify(serializableRepositoryLayoutMigrationPlan(layout), null, 2)}\n`
        : formatRepositoryLayoutMigrationPlan(layout),
    );
    return layout.status === "review_required" || layout.status === "ready" ? 0 : 1;
  }
  if (input.applyPlanId !== layout.planId)
    throw new Error("The requested plan ID does not match the current repository layout plan.");
  const baselineValidation = await lintRepositoryKnowledge(layout.repositoryRoot, {
    supplementalSources: input.supplementalSources,
  });
  const storage = await openProjectStorage(layout.repositoryRoot);
  let applied: { receipt: RepositoryLayoutMigrationReceipt; lines: string[]; notice: unknown };
  try {
    const eventIdentity = randomUUID().replaceAll("-", "");
    const apply = () =>
      applyRepositoryLayoutMigrationPlan({
        plan: layout,
        itemBindings: repositoryLayoutItemBindings(layout),
        now: new Date(),
        supplementalSources: input.supplementalSources,
        recordApplied: (receipt) =>
          recordLayoutMaterialization({
            storage,
            layout,
            applied: receipt,
            baselineValidation,
            supplementalSources: input.supplementalSources,
            eventIdentity,
          }),
      });
    if (layout.status === "review_required") {
      const { receipt, report } = await applyCrossCheckedEffect({
        crossCheckPlan: input.crossCheckPlan,
        repositoryRoot: layout.repositoryRoot,
        ...(input.provider === undefined ? {} : { provider: input.provider }),
        plan: layout,
        paths: lifecycleChangedPaths(layout),
        notice: {
          effect: "repository_layout",
          planId: layout.planId,
          reason: `moved ${layout.moves.length} documents to their classified routes, rewrote ${layout.referenceUpdates.length} references`,
        },
        apply,
      });
      applied = { receipt, lines: crossCheckedEffectLines(report), notice: report };
    } else applied = { receipt: await apply(), lines: [], notice: null };
  } finally {
    await storage.close();
  }
  const { receipt } = applied;
  migrationDeferralOutput(io, layout, input.json).stdout(
    input.json
      ? `${JSON.stringify(applied.notice === null ? receipt : { ...receipt, notice: applied.notice }, null, 2)}\n`
      : `Repository document-layout migration completed.\nplan: ${receipt.planId}\nDocument moves: ${receipt.movedCount}\nMachine-artifact moves: ${receipt.machineMovedCount}\nReference updates: ${receipt.referenceUpdatedCount}\n${applied.lines.map((line) => `${line}\n`).join("")}`,
  );
  return 0;
}
