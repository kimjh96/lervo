import { randomUUID } from "node:crypto";

import type { ProjectStorage } from "@lervo/project-storage";
import {
  canonicalJson,
  sha256,
  structuralBundleIdFromPath,
  structuralConceptIdFromPath,
  type KnowledgeMaterializationReceipt,
  type KnowledgeMigrationPlan,
} from "@lervo/repository-knowledge";

const MAXIMUM_LISTED_IDENTIFIERS = 256;

/** Records one applied structural generation as a schema-1 `knowledge.materialization.applied`. */
export async function recordStructuralMaterialization(input: {
  storage: ProjectStorage;
  plan: KnowledgeMigrationPlan;
  applied: KnowledgeMaterializationReceipt;
  validation: unknown;
}): Promise<void> {
  const { storage, plan, applied } = input;
  const validationHash = sha256(canonicalJson(input.validation));
  await storage.artifacts.put(canonicalJson(input.validation));
  const conceptChanges = plan.operations.flatMap((operation) => {
    const conceptId = structuralConceptIdFromPath(operation.path);
    return conceptId === null ? [] : [{ conceptId, action: operation.action }];
  });
  const conceptsWith = (action: string) =>
    conceptChanges.filter((item) => item.action === action).map((item) => item.conceptId);
  const createdConceptIds = conceptsWith("create");
  const updatedConceptIds = conceptsWith("update");
  const deprecatedConceptIds = conceptsWith("delete");
  const boundedConceptIds = [
    ...createdConceptIds,
    ...updatedConceptIds,
    ...deprecatedConceptIds,
  ].slice(0, MAXIMUM_LISTED_IDENTIFIERS);
  const overflow =
    createdConceptIds.length + updatedConceptIds.length + deprecatedConceptIds.length >
    MAXIMUM_LISTED_IDENTIFIERS
      ? await storage.artifacts.put(
          canonicalJson({ createdConceptIds, updatedConceptIds, deprecatedConceptIds }),
        )
      : null;
  const bundleIds = plan.operations
    .map((item) => structuralBundleIdFromPath(item.path))
    .filter((item): item is string => item !== null)
    .slice(0, MAXIMUM_LISTED_IDENTIFIERS);
  const eventIdentity = randomUUID().replaceAll("-", "");
  storage.events.append({
    eventId: `evt_${eventIdentity}`,
    projectId: plan.projectId,
    runId: `run_${eventIdentity}`,
    sessionId: `ses_${eventIdentity}`,
    type: "knowledge.materialization.applied",
    occurredAt: applied.appliedAt,
    actor: { kind: "system" },
    schemaVersion: 1,
    policyVersion: plan.policyHash,
    payload: {
      operation: plan.mode,
      planId: applied.planId,
      sourceSnapshotId: applied.sourceSnapshotId,
      policyHash: plan.policyHash,
      compilerId: plan.compiler.id,
      compilerVersion: plan.compiler.version,
      approvalDigest: null,
      coverage: plan.coverage,
      bundleIds,
      createdConceptIds: boundedConceptIds.filter((id) => createdConceptIds.includes(id)),
      updatedConceptIds: boundedConceptIds.filter((id) => updatedConceptIds.includes(id)),
      deprecatedConceptIds: boundedConceptIds.filter((id) => deprecatedConceptIds.includes(id)),
      conceptListTruncated: overflow !== null,
      resultArtifactId:
        overflow === null ? null : `art_${overflow.contentHash.slice("sha256:".length)}`,
      resultArtifactHash: overflow?.contentHash ?? null,
      createdCount: applied.created.length,
      updatedCount: applied.updated.length,
      unchangedCount: applied.unchanged.length,
      deletedCount: applied.deleted.length,
      beforeRegistryDigest: sha256(
        canonicalJson(
          plan.operations.map((item) => ({
            pathDigest: sha256(item.path),
            hash: item.expectedCurrentHash ?? null,
          })),
        ),
      ),
      afterRegistryDigest: sha256(
        canonicalJson(
          plan.operations.map((item) => ({
            pathDigest: sha256(item.path),
            hash: item.action === "delete" ? null : item.desiredHash,
          })),
        ),
      ),
      validationReportId: `klint_${validationHash.slice("sha256:".length, "sha256:".length + 24)}`,
      validationReportHash: validationHash,
      appliedAt: applied.appliedAt,
    },
  });
}
