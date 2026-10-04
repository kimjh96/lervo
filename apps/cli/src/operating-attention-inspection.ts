import type { OperatingAttentionReportV1 } from "@lervo/application-contract";
import { openProjectStorage } from "@lervo/project-storage";
import { listCanonicalizationCandidates } from "@lervo/repository-knowledge";

import { createOperatingAttentionReport } from "./operating-attention-projection.js";
import { readRepositoryReplicaDivergence } from "./repository-replica-divergence-source.js";
import { inspectTerminalLifecycle } from "./terminal-lifecycle-inspection.js";
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
        (inspection) => ({ coverage: "complete" as const, issues: inspection.issues }),
        () => ({ coverage: "unavailable" as const, issues: [] }),
      ),
      readRepositoryReplicaDivergence(input.repositoryRoot),
    ]);
    return createOperatingAttentionReport({
      projectId: storage.manifest.projectId,
      workstream,
      canonicalization,
      knowledgeLifecycle:
        replica.status === "invalid" && lifecycle.coverage !== "unavailable"
          ? { ...lifecycle, issues: [...lifecycle.issues, replica.issue] }
          : lifecycle,
      repositoryReplicaDivergence: replica.status === "observed" ? replica.divergence : null,
      observedAt: input.observedAt ?? new Date(),
    });
  } finally {
    await storage.close();
  }
};
