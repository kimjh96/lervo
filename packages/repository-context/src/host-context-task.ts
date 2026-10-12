import type { RepositoryQualityInput } from "./repository-quality-context.js";

/** Normalize host-supplied intent and observed targets; this supplies no effect authority. */
export function hostOutcomeTask(
  intent: string,
  targetPaths: readonly string[],
): RepositoryQualityInput["task"] {
  return {
    intent,
    continuation: "",
    targetPaths: [...targetPaths],
    artifactKinds: [],
    requestedActions: [targetPaths.length ? "repository.write" : "repository.read"],
    conversationLocale: null,
    publicationLocale: null,
    retrievalLanguages: [],
  };
}
