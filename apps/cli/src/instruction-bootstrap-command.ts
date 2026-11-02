import { randomUUID } from "node:crypto";

import {
  applyKnowledgeInstructionBootstrapPlan,
  createKnowledgeInstructionBootstrapPlan,
  serializableKnowledgeInstructionBootstrapPlan,
  type RepositoryKnowledgeScan,
  type RepositorySupplementalSource,
} from "@lervo/repository-knowledge";
import { lifecycleChangedPaths } from "@lervo/repository-knowledge-runtime";
import { openProjectStorage } from "@lervo/project-storage";

import { applyCrossCheckedEffect, crossCheckedEffectLines } from "./cross-checked-effect.js";
import type { CrossCheckPlan } from "./plan-cross-check.js";
import type { CliIo } from "./types.js";

/**
 * The canonical instruction bootstrap stage of `lervo migrate knowledge`. ADR-0561: `--apply`
 * cross-checks the exact adoption plan independently, applies it, and commits it as the undo
 * point; the background lifecycle reviewer applies the same plan on its own.
 */
export async function runInstructionBootstrapStage(input: {
  repositoryRoot: string;
  supplementalSources: RepositorySupplementalSource[];
  preparedScan: RepositoryKnowledgeScan;
  applyPlanId?: string;
  provider?: "codex" | "claude";
  json: boolean;
  io: CliIo;
  crossCheckPlan: CrossCheckPlan;
}): Promise<number | null> {
  const plan = await createKnowledgeInstructionBootstrapPlan({
    repositoryRoot: input.repositoryRoot,
    supplementalSources: input.supplementalSources,
    preparedScan: input.preparedScan,
  });
  if (plan.status === "not_applicable") return null;
  if (input.applyPlanId === undefined) {
    input.io.stdout(
      input.json
        ? `${JSON.stringify(serializableKnowledgeInstructionBootstrapPlan(plan), null, 2)}\n`
        : plan.status === "blocked"
          ? `Canonical instruction bootstrap is blocked.\nreason: ${plan.blocker}\nNo instruction bytes were changed.\n`
          : `Canonical instruction adoption plan created.\nplan: ${plan.planId}\nsource: CLAUDE.md · ${plan.source.contentHash}\ncanonical: AGENTS.md · ${plan.canonical.afterHash}\nCLAUDE.md and unrelated documents have not been changed. Apply with --apply ${plan.planId}; an independent cross-check reviews it first.\n`,
    );
    return plan.status === "blocked" ? 1 : 0;
  }
  if (plan.status === "blocked")
    throw new Error(`Canonical instruction bootstrap is blocked (${plan.blocker}).`);
  if (input.applyPlanId !== plan.planId)
    throw new Error(
      "The requested plan ID does not match the canonical instruction bootstrap plan.",
    );
  const storage = await openProjectStorage(input.repositoryRoot);
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
      throw new Error("The same canonical instruction bootstrap plan was already applied.");
    const identity = randomUUID().replaceAll("-", "");
    const { receipt, report } = await applyCrossCheckedEffect({
      crossCheckPlan: input.crossCheckPlan,
      repositoryRoot: input.repositoryRoot,
      ...(input.provider === undefined ? {} : { provider: input.provider }),
      plan,
      paths: lifecycleChangedPaths(plan),
      notice: {
        effect: "instruction_bootstrap",
        planId: plan.planId,
        reason: "adopted CLAUDE.md as the canonical AGENTS.md instructions",
      },
      apply: () =>
        applyKnowledgeInstructionBootstrapPlan({
          plan,
          // The plan's own content binding; the cross-check above agreed with these exact bytes.
          approvedOperationId: plan.operationId!,
          approvedHash: plan.approvalHash!,
          now: new Date(),
          supplementalSources: input.supplementalSources,
          recordApplied: (applied) => {
            storage.events.append({
              eventId: `evt_${identity}`,
              projectId: applied.projectId,
              runId: `run_${identity}`,
              sessionId: `ses_${identity}`,
              type: "knowledge.materialization.applied",
              occurredAt: applied.appliedAt,
              actor: { kind: "user" },
              schemaVersion: 1,
              policyVersion: plan.policyHash,
              payload: {
                operation: "instruction_canonical_adoption",
                planId: applied.planId,
                sourceSnapshotId: applied.sourceSnapshotId,
                policyHash: plan.policyHash,
                compilerId: "lervo.instruction-bootstrap",
                compilerVersion: "1",
                approvalDigest: applied.approvalHash,
                coverage: plan.coverage,
                bundleIds: [],
                createdConceptIds: [],
                updatedConceptIds: [],
                deprecatedConceptIds: [],
                conceptListTruncated: false,
                resultArtifactId: null,
                resultArtifactHash: null,
                createdCount: 1,
                updatedCount: 0,
                unchangedCount: 0,
                beforeRegistryDigest: null,
                afterRegistryDigest: null,
                validationReportId: null,
                validationReportHash: null,
                appliedAt: applied.appliedAt,
              },
            });
          },
        }),
    });
    input.io.stdout(
      input.json
        ? `${JSON.stringify({ ...receipt, notice: report }, null, 2)}\n`
        : `Adopted CLAUDE.md as canonical AGENTS.md instructions.\nplan: ${receipt.planId}\n${crossCheckedEffectLines(report).join("\n")}\nRun lervo migrate knowledge again for provider-bridge disposition.\n`,
    );
  } finally {
    await storage.close();
  }
  return 0;
}
