import { createHash } from "node:crypto";

import { ContextEvidenceCollector, defaultReceiptId } from "./evidence.js";
import { readRepositoryFile } from "./filesystem.js";
import { validateContextPlanForLoading } from "./plan-validation.js";
import {
  type ContextPlan,
  ContextPreparationError,
  type LoadedContext,
  type LoadedContextDocument,
} from "./types.js";

function hash(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export async function loadContextPlan(input: {
  repositoryRoot: string;
  plan: ContextPlan;
  sourceRevision: string;
  recordedAt: Date;
  createReceiptId?: () => string;
}): Promise<LoadedContext> {
  validateContextPlanForLoading(input.plan);
  if (input.recordedAt.getTime() < Date.parse(input.plan.createdAt)) {
    throw new ContextPreparationError(
      "invalid_context_plan",
      "E2 적재 시각은 context plan 생성 이후여야 합니다.",
    );
  }
  const evidence = new ContextEvidenceCollector(input.plan.evidence);
  const loaded = await Promise.all(
    input.plan.documents.map(async (document): Promise<LoadedContextDocument> => {
      const bytes = await readRepositoryFile(input.repositoryRoot, document.path);
      const contentHash = hash(bytes);
      if (
        document.expectedContentHash !== undefined &&
        document.expectedContentHash !== contentHash
      ) {
        throw new ContextPreparationError(
          "content_hash_mismatch",
          `${document.documentId}의 현재 content hash가 handoff와 다릅니다.`,
        );
      }
      return {
        ...document,
        bytes,
        contentHash,
        byteCount: bytes.byteLength,
        sourceRevision: input.sourceRevision,
      };
    }),
  );
  const createReceiptId = input.createReceiptId ?? defaultReceiptId;
  const recordedAt = input.recordedAt.toISOString();
  for (const document of loaded) {
    evidence.add({
      receiptId: createReceiptId(),
      projectId: input.plan.coordinates.projectId,
      runId: input.plan.coordinates.runId,
      sessionId: input.plan.coordinates.sessionId,
      documentId: document.documentId,
      state: "loaded",
      recordedAt,
      scope: document.scope,
      contentHash: document.contentHash,
      byteCount: document.byteCount,
      sourceRevision: document.sourceRevision,
    });
  }
  return {
    plan: input.plan,
    documents: loaded,
    evidence: evidence.values(),
    loadedAt: recordedAt,
  };
}
