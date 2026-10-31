import type { KnowledgeLintResult } from "@lervo/repository-knowledge";

export type ConversationRepositoryWorkKnowledgeDisposition = "current" | "baseline_valid";

export async function resolveConversationRepositoryWorkKnowledgeDisposition(input: {
  changedPathCount: number;
  baselineKnowledgeCurrent: boolean;
  assertCurrent: () => Promise<void>;
  lintReport: () => Promise<Pick<KnowledgeLintResult, "valid" | "coverage">>;
}): Promise<ConversationRepositoryWorkKnowledgeDisposition> {
  if (input.changedPathCount === 0 && input.baselineKnowledgeCurrent) return "current";

  try {
    await input.assertCurrent();
    return "current";
  } catch (error) {
    if (!input.baselineKnowledgeCurrent) {
      const lint = await input.lintReport();
      if (lint.coverage === "complete" && lint.valid) return "baseline_valid";
    }
    throw error;
  }
}
