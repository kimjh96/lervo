import type { OperatingAttentionReportV1 } from "@lervo/application-contract";
import { openProjectStorage } from "@lervo/project-storage";
import {
  defaultWorkstreamFreshnessPolicy,
  listCanonicalizationCandidates,
  loadRepositoryKnowledgePolicy,
  workstreamFreshnessPolicy,
} from "@lervo/repository-knowledge";

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
    const [workstream, canonicalization, lifecycle, replica] = await Promise.all([
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
    ]);
    const observedAt = input.observedAt ?? new Date();
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
      observedAt,
    });
  } finally {
    await storage.close();
  }
};
