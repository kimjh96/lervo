import type { OperatingAttentionReportV1 } from "@lervo/application-contract";
import { openProjectStorage } from "@lervo/project-storage";
import {
  defaultWorkstreamFreshnessPolicy,
  listCanonicalizationCandidates,
  loadRepositoryKnowledgePolicy,
  workstreamFreshnessPolicy,
} from "@lervo/repository-knowledge";

import { readDocumentFreshnessAttention } from "./document-freshness-attention.js";
import { readInstructionCaptureAttention } from "./instruction-capture-attention.js";
import { readKnowledgeConvergenceAttention } from "./knowledge-convergence-attention.js";
import { createOperatingAttentionReport } from "./operating-attention-projection.js";
import { readRepositoryReplicaDivergence } from "./repository-replica-divergence-source.js";
import { inspectTerminalLifecycle } from "./terminal-lifecycle-inspection.js";
import { observeWorkstreamFreshness } from "./workstream-repository-head.js";
import { verifiedCurrentWorkstream } from "./workstream-services.js";

export interface InspectOperatingAttentionInput {
  repositoryRoot: string;
  observedAt?: Date;
}

export type InspectOperatingAttention = (
  input: InspectOperatingAttentionInput,
) => Promise<OperatingAttentionReportV1>;

export const inspectOperatingAttention: InspectOperatingAttention = async (input) => {
  const storage = await openProjectStorage(input.repositoryRoot);
  try {
    const observedAt = input.observedAt ?? new Date();
    const [
      workstream,
      canonicalization,
      lifecycle,
      replica,
      documentFreshness,
      instructionCapture,
      convergence,
    ] = await Promise.all([
      verifiedCurrentWorkstream(storage),
      listCanonicalizationCandidates(input.repositoryRoot).then(
        (candidates) => ({ coverage: "complete" as const, candidates }),
        () => ({ coverage: "unavailable" as const, candidates: [] }),
      ),
      inspectTerminalLifecycle(input.repositoryRoot).then(
        (inspection) => ({
          coverage: "complete" as const,
          issues: [...inspection.issues, ...(inspection.knowledgeAdvisories ?? [])],
        }),
        () => ({ coverage: "unavailable" as const, issues: [] }),
      ),
      readRepositoryReplicaDivergence(input.repositoryRoot),
      readDocumentFreshnessAttention(input.repositoryRoot, observedAt),
      readInstructionCaptureAttention(input.repositoryRoot),
      readKnowledgeConvergenceAttention(input.repositoryRoot, storage.manifest.projectId).catch(
        () => null,
      ),
    ]);
    const workstreamFreshness =
      workstream === null
        ? null
        : await observeWorkstreamFreshness({
            root: input.repositoryRoot,
            snapshot: workstream,
            policy: await loadRepositoryKnowledgePolicy(input.repositoryRoot).then(
              workstreamFreshnessPolicy,
              () => defaultWorkstreamFreshnessPolicy,
            ),
            observedAt,
          });
    return createOperatingAttentionReport({
      projectId: storage.manifest.projectId,
      workstream,
      workstreamFreshness,
      canonicalization,
      knowledgeLifecycle:
        replica.status === "invalid" && lifecycle.coverage !== "unavailable"
          ? { ...lifecycle, issues: [...lifecycle.issues, replica.issue] }
          : lifecycle,
      repositoryReplicaDivergence: replica.status === "observed" ? replica.divergence : null,
      documentFreshness,
      instructionCapture,
      knowledgeConvergence: convergence,
      observedAt,
    });
  } finally {
    await storage.close();
  }
};
