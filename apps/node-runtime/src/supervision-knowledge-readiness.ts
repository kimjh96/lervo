import type { OutcomeSupervisionPorts } from "@lervo/orchestrator";
import {
  assertNoKnowledgeMaterializationTransaction,
  inspectConfiguredDocumentNormalization,
  lintRepositoryKnowledge,
  scanConfiguredRepositoryKnowledge,
} from "@lervo/repository-knowledge";
import { operatingContractHash } from "@lervo/work-controller";

type Readiness = Awaited<ReturnType<OutcomeSupervisionPorts["readWorkerReadiness"]>>;

interface KnowledgeInspection {
  observedAt: string;
  validUntil: string;
  evidenceHash: string | null;
}

/** Expensive source validation precedes the short-lived permission and lease observations. */
export async function inspectSupervisionKnowledgeReadiness(input: {
  repositoryRoot: string;
  projectId: string;
  now(): string;
}): Promise<KnowledgeInspection> {
  const started = input.now();
  const inspection: KnowledgeInspection = {
    observedAt: started,
    validUntil: new Date(Date.parse(started) + 60_000).toISOString(),
    evidenceHash: null,
  };
  try {
    const before = await scanConfiguredRepositoryKnowledge(input.repositoryRoot);
    const normalization = await inspectConfiguredDocumentNormalization({
      repositoryRoot: input.repositoryRoot,
      preparedScan: before.scan,
    });
    const lint = await lintRepositoryKnowledge(input.repositoryRoot, {
      preparedScan: before.scan,
      preparedNormalization: normalization,
    });
    const after = await scanConfiguredRepositoryKnowledge(input.repositoryRoot);
    await assertNoKnowledgeMaterializationTransaction({ repositoryRoot: input.repositoryRoot });
    const elapsed = Date.parse(input.now()) - Date.parse(started);
    if (
      before.manifest.projectId !== input.projectId ||
      after.manifest.projectId !== input.projectId ||
      !before.scan.coverage.complete ||
      !after.scan.coverage.complete ||
      before.scan.snapshotId !== after.scan.snapshotId ||
      operatingContractHash(before.policy) !== operatingContractHash(after.policy) ||
      !lint.valid ||
      lint.issues.length !== 0 ||
      normalization.pendingDocuments.length !== 0 ||
      !Number.isFinite(elapsed) ||
      elapsed < 0 ||
      elapsed > 60_000
    )
      return inspection;
    inspection.evidenceHash = operatingContractHash({
      projectId: input.projectId,
      sourceSnapshotId: after.scan.snapshotId,
      policyHash: operatingContractHash(after.policy),
      normalizationHash: operatingContractHash(normalization),
      lintHash: operatingContractHash(lint),
    });
  } catch {
    return inspection;
  }
  return inspection;
}

/** Supplements positive context evidence without refreshing its observation time. */
export async function observeSupervisionKnowledgeReadiness(input: {
  repositoryRoot: string;
  projectId: string;
  readiness: Readiness;
  now(): string;
  preparedInspection?: KnowledgeInspection;
}): Promise<Readiness> {
  const readiness = structuredClone(input.readiness);
  const check = readiness.observation.checks.find((item) => item.kind === "knowledge");
  if (check?.status !== "passed" || check.evidenceHash === null) return readiness;
  const inspection =
    input.preparedInspection ?? (await inspectSupervisionKnowledgeReadiness(input));
  const age = Date.parse(input.now()) - Date.parse(inspection.observedAt);
  if (inspection.evidenceHash === null || !Number.isFinite(age) || age < 0 || age > 60_000) {
    check.status = "unobserved";
    check.evidenceHash = null;
  } else {
    check.evidenceHash = operatingContractHash({
      adapter: check.evidenceHash,
      repository: inspection,
    });
    if (Date.parse(inspection.validUntil) < Date.parse(readiness.observation.validUntil))
      readiness.observation.validUntil = inspection.validUntil;
  }
  return readiness;
}
