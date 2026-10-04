import { randomUUID } from "node:crypto";
import { canonicalJson, sha256 } from "@lervo/repository-knowledge";
import type { ProjectStorage } from "@lervo/project-storage";

/** Full effect receipts remain private; the existing materialization event records bounded coordinates. */
export async function recordConvergenceMaterialization(
  storage: ProjectStorage,
  input: {
    operation: string;
    planId: string;
    sourceSnapshotId: string;
    policyHash: string;
    receipt: unknown;
    created: string[];
    updated: string[];
    deleted: string[];
    validation: unknown;
  },
): Promise<void> {
  const receipt = await storage.artifacts.put(canonicalJson(input.receipt));
  const validation = await storage.artifacts.put(canonicalJson(input.validation));
  const id = randomUUID().replaceAll("-", "");
  storage.events.append({
    eventId: `evt_${id}`,
    runId: `run_${id}`,
    sessionId: `ses_${id}`,
    projectId: storage.manifest.projectId,
    actor: { kind: "system" },
    schemaVersion: 4,
    type: "knowledge.materialization.applied",
    occurredAt: new Date().toISOString(),
    policyVersion: input.policyHash,
    payload: {
      operation: input.operation,
      planId: input.planId,
      sourceSnapshotId: input.sourceSnapshotId,
      policyHash: input.policyHash,
      compilerId: "lervo.background-convergence",
      compilerVersion: "1",
      compilerBuildId: sha256("lervo.background-convergence-v1"),
      approvalDigest: sha256(canonicalJson(input.receipt)),
      coverage: {},
      bundleIds: [],
      createdConceptIds: [],
      updatedConceptIds: [],
      deprecatedConceptIds: [],
      conceptListTruncated: false,
      resultArtifactId: `art_${receipt.contentHash.slice(7, 39)}`,
      resultArtifactHash: receipt.contentHash,
      createdCount: input.created.length,
      updatedCount: input.updated.length,
      unchangedCount: 0,
      deletedCount: input.deleted.length,
      beforeRegistryDigest: sha256(canonicalJson(input.deleted)),
      afterRegistryDigest: sha256(canonicalJson([...input.created, ...input.updated])),
      validationReportId: `klint_${validation.contentHash.slice(7, 31)}`,
      validationReportHash: validation.contentHash,
      appliedAt: new Date().toISOString(),
    },
  });
}
