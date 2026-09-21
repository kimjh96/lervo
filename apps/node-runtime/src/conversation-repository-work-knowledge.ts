export type ConversationRepositoryWorkKnowledgeDisposition = "current" | "baseline_valid";

export async function resolveConversationRepositoryWorkKnowledgeDisposition(input: {
  changedPathCount: number;
  baselineKnowledgeCurrent: boolean;
  assertCurrent: () => Promise<void>;
  lintIsValid: () => Promise<boolean>;
}): Promise<ConversationRepositoryWorkKnowledgeDisposition> {
  if (input.changedPathCount === 0) {
    return input.baselineKnowledgeCurrent ? "current" : "baseline_valid";
  }

  try {
    await input.assertCurrent();
    return "current";
  } catch (error) {
    if (!input.baselineKnowledgeCurrent && (await input.lintIsValid())) return "baseline_valid";
    throw error;
  }
}
