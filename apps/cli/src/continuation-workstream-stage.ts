import { randomUUID } from "node:crypto";

import {
  applyContinuationWorkstreamMigrationPlan,
  createContinuationWorkstreamMigrationPlan,
  RepositoryKnowledgeError,
  type RepositoryKnowledgeScan,
  type RepositorySupplementalSource,
} from "@lervo/repository-knowledge";
import { lifecycleChangedPaths } from "@lervo/repository-knowledge-runtime";
import { openProjectStorage } from "@lervo/project-storage";

import { applyCrossCheckedEffect, crossCheckedEffectLines } from "./cross-checked-effect.js";
import type { CrossCheckPlan } from "./plan-cross-check.js";
import type { CliIo } from "./types.js";

function printablePlan(
  plan: Awaited<ReturnType<typeof createContinuationWorkstreamMigrationPlan>>,
): unknown {
  return {
    ...plan,
    operations: plan.operations.map((operation) => {
      if (!("content" in operation)) return operation;
      const { content: _content, ...printable } = operation;
      return printable;
    }),
  };
}

/**
 * The legacy continuation workstream stage of `lervo migrate knowledge`. ADR-0561: `--apply`
 * cross-checks the exact plan independently, applies it, and commits it as the undo point.
 * Returns null when the stage is current.
 */
export async function runContinuationWorkstreamStage(input: {
  repositoryRoot: string;
  sourcePath?: string;
  supplementalSources: RepositorySupplementalSource[];
  preparedScan?: RepositoryKnowledgeScan;
  applyPlanId?: string;
  provider?: "codex" | "claude";
  json: boolean;
  io: CliIo;
  crossCheckPlan: CrossCheckPlan;
}): Promise<number | null> {
  const projectStorage = await openProjectStorage(input.repositoryRoot);
  let plan;
  try {
    plan = await createContinuationWorkstreamMigrationPlan({
      repositoryRoot: input.repositoryRoot,
      projectId: projectStorage.manifest.projectId,
      ...(input.sourcePath === undefined ? {} : { sourcePath: input.sourcePath }),
      supplementalSources: input.supplementalSources,
      ...(input.preparedScan === undefined ? {} : { preparedScan: input.preparedScan }),
    });
  } finally {
    await projectStorage.close();
  }
  if (plan.status === "current") return null;
  const { io } = input;
  if (input.applyPlanId === undefined) {
    io.stdout(
      input.json
        ? `${JSON.stringify(printablePlan(plan), null, 2)}\n`
        : plan.status === "blocked"
          ? `Continuation workstream migration is blocked.\n${plan.blockers.map((item) => `  [${item.code}] ${item.message}`).join("\n")}\n${plan.candidates.map((item) => `  candidate: ${item.path} declared=${item.signals.join(",")}`).join("\n")}\n`
          : `Continuation workstream migration plan created.\nplan: ${plan.planId}\nworkstream: ${plan.workstream?.workstreamId}\nsource: ${plan.sourcePath} (${plan.sourceContentHash})\nreferences updated: ${plan.referenceUpdates.length}\nnormalization records retired: ${plan.removedNormalizationRecords.length}\nNo files or state have been changed. Apply with --apply ${plan.planId}; an independent cross-check reviews it first.\n`,
    );
    return plan.status === "blocked" ? 1 : 0;
  }
  if (plan.status === "blocked")
    throw new Error("The continuation workstream migration is blocked.");
  if (input.applyPlanId !== plan.planId)
    throw new Error(
      "The requested plan ID does not match the current continuation workstream migration plan.",
    );
  const reviewed = plan;
  const storage = await openProjectStorage(input.repositoryRoot);
  try {
    const eventIdentity = randomUUID().replaceAll("-", "");
    const { receipt, report } = await applyCrossCheckedEffect({
      crossCheckPlan: input.crossCheckPlan,
      repositoryRoot: input.repositoryRoot,
      ...(input.provider === undefined ? {} : { provider: input.provider }),
      plan: reviewed,
      paths: lifecycleChangedPaths(reviewed),
      notice: {
        effect: "continuation_workstream",
        planId: reviewed.planId,
        reason: `migrated ${reviewed.sourcePath} into Lervo workstream state`,
      },
      apply: () =>
        applyContinuationWorkstreamMigrationPlan({
          plan: reviewed,
          // The plan's own content binding; the cross-check above agreed with these exact bytes.
          approvedOperationId: reviewed.operationId!,
          approvedHash: reviewed.approvalHash!,
          now: new Date(),
          supplementalSources: input.supplementalSources,
          recordApplied: async (applied, artifacts) => {
            const sourceArtifact = await storage.artifacts.put(artifacts.sourceContent);
            const snapshotArtifact = await storage.artifacts.put(artifacts.snapshotContent);
            if (
              sourceArtifact.contentHash !== applied.sourceContentHash ||
              snapshotArtifact.contentHash !== applied.snapshotContentHash
            ) {
              throw new RepositoryKnowledgeError(
                "knowledge_apply_failed",
                "The persisted workstream artifacts differ from the migration bindings.",
              );
            }
            storage.events.append({
              eventId: `evt_${eventIdentity}`,
              projectId: applied.projectId,
              runId: `run_${eventIdentity}`,
              sessionId: `ses_${eventIdentity}`,
              type: "workstream.snapshot.recorded",
              occurredAt: applied.appliedAt,
              actor: { kind: "user" },
              schemaVersion: 1,
              policyVersion: applied.approvalHash,
              payload: {
                workstreamId: applied.workstreamId,
                revision: applied.revision,
                status: applied.status,
                changeKind: "legacy_continuation_migration",
                snapshotArtifactId: `art_${applied.snapshotContentHash.slice("sha256:".length)}`,
                snapshotContentHash: applied.snapshotContentHash,
                previousSnapshotContentHash: applied.previousSnapshotContentHash,
                sourceArtifactId: `art_${applied.sourceContentHash.slice("sha256:".length)}`,
                sourceContentHash: applied.sourceContentHash,
                recordedAt: applied.appliedAt,
              },
            });
          },
        }),
    });
    io.stdout(
      input.json
        ? `${JSON.stringify({ ...receipt, notice: report }, null, 2)}\n`
        : `Migrated ${reviewed.sourcePath} into Lervo workstream state.\nworkstream: ${receipt.workstreamId}\nreferences updated: ${receipt.referenceUpdatedCount}\n${crossCheckedEffectLines(report).join("\n")}\nRun lervo migrate knowledge again to refresh canonical documentation and navigation.\n`,
    );
  } finally {
    await storage.close();
  }
  return 0;
}
