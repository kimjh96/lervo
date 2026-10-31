import { KnowledgeProviderAvailabilityError } from "@lervo/repository-knowledge-compiler";

/** Availability failures skip one provider; other failures keep their original scope. */
export function providerCliProbePaused(error: unknown): boolean {
  return (
    error instanceof KnowledgeProviderAvailabilityError ||
    (error instanceof Error && "code" in error && error.code === "knowledge_provider_paused")
  );
}
