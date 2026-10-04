import { knowledgeConvergenceStages } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";
import { canonicalJson, sha256 } from "./integrity.js";
import type { KnowledgeConvergenceInput } from "./knowledge-convergence-contract.js";
import type { KnowledgeConvergenceProjection } from "./knowledge-convergence-replay.js";

const HASH = /^sha256:[a-f0-9]{64}$/u;

function invalid(): never {
  throw Object.assign(new Error("The convergence input or receipt is invalid."), {
    code: "knowledge_job_source_invalid",
  });
}

/** Private CAS is evidence only when its bytes and canonical baseline identity agree. */
export async function assertKnowledgeConvergenceInput(input: {
  value: KnowledgeConvergenceInput;
  baseline: KnowledgeConvergenceProjection["baseline"];
  artifacts: ArtifactStore;
  expectedBaseline?: KnowledgeConvergenceInput["baseline"];
}): Promise<void> {
  const value = input.value;
  const baseline = input.baseline.payload;
  if (
    value?.schemaVersion !== 1 ||
    value.obligationId !== baseline.obligationId ||
    value.baseline?.schemaVersion !== 1 ||
    value.baseline.projectId !== input.baseline.projectId ||
    value.baseline.sourceSnapshotId !== baseline.sourceSnapshotId ||
    value.baseline.sourceSnapshotHash !== baseline.sourceSnapshotHash ||
    value.baseline.policyHash !== baseline.policyHash ||
    value.baseline.debtDigest !== baseline.debtDigest ||
    value.baseline.delegationHash !== baseline.delegationHash ||
    canonicalJson(value.baseline.debtCounts) !== canonicalJson(baseline.debtCounts) ||
    (input.expectedBaseline !== undefined &&
      canonicalJson(input.expectedBaseline) !== canonicalJson(value.baseline)) ||
    !HASH.test(value.snapshotHash) ||
    !Array.isArray(value.receipts) ||
    value.receipts.length > knowledgeConvergenceStages.length ||
    new Set(value.receipts.map((receipt) => receipt?.stage)).size !== value.receipts.length ||
    !value.stageData ||
    typeof value.stageData !== "object" ||
    Array.isArray(value.stageData)
  )
    invalid();
  for (const receipt of value.receipts) {
    if (
      !knowledgeConvergenceStages.includes(receipt?.stage) ||
      !HASH.test(receipt.artifactHash) ||
      !HASH.test(receipt.snapshotHash)
    )
      invalid();
    const bytes = await input.artifacts.get(`lervo-cas://sha256/${receipt.artifactHash.slice(7)}`);
    if (!bytes || bytes.byteLength > 16 * 1024 * 1024 || sha256(bytes) !== receipt.artifactHash)
      invalid();
    const proof = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes)) as {
      schemaVersion?: number;
      obligationId?: string;
      stage?: string;
      policyHash?: string;
      delegationHash?: string | null;
      sourceSnapshotHash?: string;
      resultSnapshotHash?: string;
    } | null;
    if (
      proof?.schemaVersion !== 1 ||
      proof.obligationId !== value.obligationId ||
      proof.stage !== receipt.stage ||
      proof.policyHash !== baseline.policyHash ||
      proof.delegationHash !== baseline.delegationHash ||
      !HASH.test(proof.sourceSnapshotHash ?? "") ||
      proof.resultSnapshotHash !== receipt.snapshotHash
    )
      invalid();
  }
}
